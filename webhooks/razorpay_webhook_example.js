/*
Server webhook example for Razorpay (Node.js + Express)
- This endpoint receives a payment webhook from Razorpay, verifies the signature,
  and then calls the Firebase callable function creditDeposit via Admin SDK or uses
  the Firebase Admin to update Firestore safely.
- IMPORTANT: Use your server to verify Razorpay payment, do not trust client signals.
- This example uses the Razorpay payment_id and signature from headers.
*/

const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const admin = require('firebase-admin');

// Initialize Firebase Admin with service account on your server
// admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const app = express();
app.use(bodyParser.json({ verify: (req, res, buf) => { req.rawBody = buf } }));

const RAZORPAY_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET; // set this in env

app.post('/webhook/razorpay', async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const payload = req.rawBody; // raw buffer
  // Verify signature
  const expected = crypto.createHmac('sha256', RAZORPAY_SECRET).update(payload).digest('hex');
  if (signature !== expected) {
    console.warn('Invalid signature');
    return res.status(400).send('invalid signature');
  }

  const event = req.body;
  // Example event: payment.captured or payment.authorized
  if (event.event === 'payment.captured' || event.event === 'payment.authorized') {
    const payment = event.payload.payment.entity;
    const amount = payment.amount / 100.0; // Razorpay amount is in paise
    const providerId = payment.id; // razorpay payment id
    const email = payment.email || null; // may not be present

    // Map payment to user: you should store a reference from your UI when creating order
    // Example: store order with metadata: { userId: 'uid', amount } and read it here.
    const orderId = payment.order_id; // your order id sent earlier
    try{
      // Lookup a mapping from orderId to userId in Firestore
      const orderDoc = await db.collection('payments').doc(orderId).get();
      if(!orderDoc.exists){
        console.error('Order mapping not found', orderId);
        return res.status(400).send('order not found');
      }
      const data = orderDoc.data();
      const userId = data.userId;
      // Now credit the user idempotently
      const processedRef = db.collection('processedPayments').doc('razorpay_'+providerId);
      await db.runTransaction(async tx => {
        const p = await tx.get(processedRef);
        if(p.exists) return; // already processed
        const userRef = db.collection('users').doc(userId);
        const u = await tx.get(userRef);
        if(!u.exists) tx.set(userRef,{balance:0,wins:0,losses:0,total:0});
        const prev = u.exists && u.data().balance!=null ? Number(u.data().balance):0;
        const next = Math.round((prev + amount)*100)/100;
        tx.set(processedRef, { provider: 'razorpay', providerId, amount, userId, ts: admin.firestore.FieldValue.serverTimestamp() });
        tx.update(userRef, { balance: next });
        const txRef = userRef.collection('transactions').doc();
        tx.set(txRef, { type: 'deposit', amount, provider: 'razorpay', providerId, date: admin.firestore.FieldValue.serverTimestamp() });
      });

      return res.status(200).send('ok');
    }catch(err){
      console.error('webhook error',err);
      return res.status(500).send('error');
    }
  }

  res.status(200).send('ignored');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log('Razorpay webhook server running on',PORT));
