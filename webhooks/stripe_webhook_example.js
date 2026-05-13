/*
Server webhook example for Stripe (Node.js + Express)
- This endpoint receives Stripe webhook events, verifies the signature using the
  Stripe signing secret, and then credits the user's balance in Firestore.
- Use Stripe payment_intent.succeeded or charge.succeeded events.
- The server should map the Stripe payment to your user (e.g., via metadata when creating the Checkout Session).
*/

const express = require('express');
const bodyParser = require('body-parser');
const Stripe = require('stripe');
const admin = require('firebase-admin');

// Initialize Firebase Admin with service account on your server
// admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

const app = express();
app.use(bodyParser.raw({ type: 'application/json' }));

app.post('/webhook/stripe', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try{
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  }catch(err){
    console.warn('Stripe signature verification failed', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if(event.type === 'payment_intent.succeeded' || event.type === 'charge.succeeded'){
    const obj = event.data.object;
    const amount = (obj.amount_received || obj.amount)/100.0; // in rupees/INR if currency is INR
    // Map to user via metadata or session
    const userId = obj.metadata && obj.metadata.userId;
    const providerId = obj.id || obj.payment_intent || obj.charge;
    if(!userId){ console.error('No userId in metadata'); return res.status(400).send('no user mapping'); }

    try{
      const processedRef = db.collection('processedPayments').doc('stripe_'+providerId);
      await db.runTransaction(async tx=>{
        const p = await tx.get(processedRef);
        if(p.exists) return;
        const userRef = db.collection('users').doc(userId);
        const u = await tx.get(userRef);
        if(!u.exists) tx.set(userRef,{balance:0,wins:0,losses:0,total:0});
        const prev = u.exists && u.data().balance!=null ? Number(u.data().balance):0;
        const next = Math.round((prev + amount)*100)/100;
        tx.set(processedRef, { provider: 'stripe', providerId, amount, userId, ts: admin.firestore.FieldValue.serverTimestamp() });
        tx.update(userRef, { balance: next });
        const txRef = userRef.collection('transactions').doc();
        tx.set(txRef, { type: 'deposit', amount, provider: 'stripe', providerId, date: admin.firestore.FieldValue.serverTimestamp() });
      });
      return res.status(200).send('ok');
    }catch(err){ console.error('stripe webhook error', err); return res.status(500).send('error'); }
  }

  res.status(200).send('event ignored');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log('Stripe webhook server running on',PORT));
