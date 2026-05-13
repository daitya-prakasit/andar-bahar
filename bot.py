import json
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.ext import Application, CommandHandler, MessageHandler, filters, CallbackQueryHandler, ContextTypes

# ==================== CONFIG ====================
BOT_TOKEN = "8737953052:AAF62gUlOZDOn8rF7pWkkv4D-6D3hK61n9k"
WEBAPP_URL = "https://daitya-prakasit.github.io/Nbot/"

# ==================== COMMANDS ====================

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Start command - Welcome + Play button"""
    user = update.effective_user
    welcome_text = f"""
🎮 *ANDAR BAHAR - Telegram Mini Game* 🎮

Welcome, {user.first_name}! 🇮🇳

*Bina kisi app download ke khelein!*

🃏 Joker card pick hoga
💰 Aap Andar ya Bahar bet lagayein
🎯 Match hone pe jeet!

👇 Neeche button dabayein game khelne ke liye
"""
    keyboard = [
        [InlineKeyboardButton(
            "🎮 PLAY ANDAR BAHAR 🎮",
            web_app=WebAppInfo(url=WEBAPP_URL)
        )],
        [
            InlineKeyboardButton("📖 Kaise Khelein", callback_data='help'),
        ]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    await update.message.reply_text(welcome_text, parse_mode='Markdown', reply_markup=reply_markup)

async def help_button(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Help button handler"""
    query = update.callback_query
    await query.answer()
    help_text = """
🃏 *ANDAR BAHAR - Game Rules*

1️⃣ Ek *Joker Card* randomly pick hota hai
2️⃣ Aap bet lagate hain — *Andar* ya *Bahar*
3️⃣ Cards dono piles mein alternate dealt hote hain
4️⃣ Jahan joker jaisa card pehle aaye — *wahi side jeet-ti hai!*

*Card Values:*
A = 1 (Ace)
J = 11 (Jack)
Q = 12 (Queen)
K = 13 (King)

*Example:*
Joker = 7♥️
Andar pile: 3♠️, K♦️, 7♣️ ✅
Bahar pile: 2♥️, 9♠️

👉 Andar side jeeti — kyunki 7 wahan pehle aaya!

/start - Wapas main menu
"""
    keyboard = [[InlineKeyboardButton("🔙 Back to Main Menu", callback_data='back')]]
    reply_markup = InlineKeyboardMarkup(keyboard)
    await query.edit_message_text(help_text, parse_mode='Markdown', reply_markup=reply_markup)

async def back_button(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Back button handler"""
    query = update.callback_query
    await query.answer()
    user = update.effective_user
    welcome_text = f"""
🎮 *ANDAR BAHAR - Telegram Mini Game* 🎮

Welcome, {user.first_name}! 🇮🇳

👇 Neeche button dabayein game khelne ke liye
"""
    keyboard = [
        [InlineKeyboardButton(
            "🎮 PLAY ANDAR BAHAR 🎮",
            web_app=WebAppInfo(url=WEBAPP_URL)
        )],
        [
            InlineKeyboardButton("📖 Kaise Khelein", callback_data='help'),
        ]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    await query.edit_message_text(welcome_text, parse_mode='Markdown', reply_markup=reply_markup)

async def web_app_data(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Receive game stats from Web App"""
    try:
        data = json.loads(update.effective_message.web_app_data.data)
        user = update.effective_user

        wins = data.get('wins', 0)
        losses = data.get('losses', 0)
        total = data.get('total', 0)
        last_result = data.get('lastResult', 'unknown')

        if total > 0:
            win_rate = (wins / total) * 100
        else:
            win_rate = 0

        last_emoji = '🟢 WIN' if last_result == 'win' else '🔴 LOSS'

        result_text = f"""
📊 *Game Stats — {user.first_name}*

🏆 Wins: `{wins}`
😞 Losses: `{losses}`
🎯 Total Games: `{total}`
📈 Win Rate: `{win_rate:.1f}%`
📌 Last Game: {last_emoji}

{"🔥 Bahut badhiya!" if win_rate >= 60 else "💪 Keep practicing!" if win_rate >= 40 else "🍀 Better luck next time!"}

/start - Play again!
"""
        await update.message.reply_text(result_text, parse_mode='Markdown')

    except Exception as e:
        print(f"Error processing web app data: {e}")
        await update.message.reply_text("❌ Error receiving game data. Please try again.")

async def error_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle errors"""
    print(f"Update {update} caused error {context.error}")

# ==================== MAIN ====================

def main():
    """Start the bot"""
    print("=" * 50)
    print("🤖 Andar Bahar Mini App Bot")
    print("=" * 50)
    print(f"🌐 WebApp URL: {WEBAPP_URL}")
    print("=" * 50)

    # Build application
    app = Application.builder().token(BOT_TOKEN).build()

    # Add handlers
    app.add_handler(CommandHandler('start', start))
    app.add_handler(CallbackQueryHandler(help_button, pattern='^help$'))
    app.add_handler(CallbackQueryHandler(back_button, pattern='^back$'))
    app.add_handler(MessageHandler(filters.StatusUpdate.WEB_APP_DATA, web_app_data))
    app.add_error_handler(error_handler)

    # Start bot
    print("✅ Bot is running...")
    print("📱 Telegram pe /start karein!")
    print("⏹️  Press Ctrl+C to stop")
    print("=" * 50)

    app.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == '__main__':
    main()
