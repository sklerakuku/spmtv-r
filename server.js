import express from 'express';
import dotenv from 'dotenv';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;

// Функция для добавления строки в таблицу
async function addRowToSheet(data) {
  try {
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'A:I', // Диапазон колонок (A до I)
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }),
          data.discordId || '',
          data.discordNick || '',
          data.minecraftNick || '',
          data.question || '',
          data.category || '',
          data.supportType === 'participant' ? 'Участник с вопросом' : 'Поддержка',
          data.amount || '',
          data.paymentStatus || 'Ожидание'
        ]],
      },
    });
    console.log('✅ Данные добавлены в Google Sheet');
    return response.data;
  } catch (error) {
    console.error('❌ Ошибка добавления в Google Sheet:', error.message);
    throw error;
  }
}

// Функция для обновления статуса оплаты
async function updatePaymentStatus(discordId, amount, status) {
  try {
    // Получаем все строки
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'A:I',
    });
    
    const rows = response.data.values || [];
    
    // Ищем строку с соответствующим Discord ID и суммой
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      if (row[1] === discordId && row[7] === amount && row[8] === 'Ожидание') {
        // Обновляем статус в колонке I (индекс 8)
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `I${i + 1}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [[status]]
          },
        });
        console.log(`✅ Статус оплаты обновлён для ${discordId}`);
        return true;
      }
    }
    console.log('⚠️ Строка для обновления не найдена');
    return false;
  } catch (error) {
    console.error('❌ Ошибка обновления статуса:', error.message);
    throw error;
  }
}

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  console.log('Headers:', req.headers);
  if (req.method === 'POST') console.log('Body:', req.body);
  next();
});

// Главная страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Страница успеха
app.get('/success.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'success.html'));
});

// ============ DISCORD AUTH ============
app.get('/api/auth/login', (req, res) => {
  console.log('🚀 Discord login initiated');
  const url = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&scope=identify`;
  console.log('Redirecting to:', url);
  res.redirect(url);
});

app.get('/api/auth/callback', async (req, res) => {
  console.log('📥 Discord callback received');
  const { code } = req.query;
  
  if (!code) {
    console.error('❌ No code in callback');
    return res.status(400).send('No code provided');
  }
  
  try {
    console.log('🔄 Exchanging code for token...');
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: process.env.REDIRECT_URI,
        scope: 'identify',
      }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const tokenData = await tokenResponse.json();
    console.log('✅ Token received');

    console.log('🔄 Fetching user data...');
    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userData = await userResponse.json();
    console.log('✅ User data received:', userData.username);

    let avatarUrl = null;
    if (userData.avatar) {
      avatarUrl = `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`;
    }

    const avatarParam = avatarUrl ? `&avatar=${encodeURIComponent(avatarUrl)}` : '';
    res.redirect(`/?id=${userData.id}&nick=${userData.username}${avatarParam}`);
  } catch (error) {
    console.error('❌ Discord auth error:', error);
    res.status(500).send('Ошибка авторизации через Discord');
  }
});

// ============ SPWORLDS API ============
app.get('/api/get-user', async (req, res) => {
  const { id } = req.query;
  console.log('🔍 Get user request:', id);
  
  try {
    const authString = `${process.env.SP_CARD_ID}:${process.env.SP_TOKEN}`;
    const base64Auth = Buffer.from(authString).toString('base64');
    
    console.log('🔄 Fetching from SPWorlds...');
    const response = await fetch(`https://spworlds.ru/api/public/users/${id}`, {
      headers: { 
        'Authorization': `Bearer ${base64Auth}`,
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      }
    });
    
    const data = await response.json();
    console.log('✅ SPWorlds user data:', data);
    res.status(200).json(data);
    
  } catch (error) {
    console.error('❌ Get user error:', error);
    res.status(200).json({ username: null });
  }
});

app.post('/api/create-pay', async (req, res) => {
  console.log('💳 Create payment request');
  
  try {
    const { amount, discordId } = req.body;
    console.log('Amount:', amount, 'Discord ID:', discordId);

    // Сохраняем данные формы из localStorage (придут в теле запроса)
    const { question, category, supportType, discordNick, minecraftNick } = req.body.metadata || {};

    const authString = `${process.env.SP_CARD_ID}:${process.env.SP_TOKEN}`;
    const base64Auth = Buffer.from(authString).toString('base64');

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const redirectUrl = `${protocol}://${host}/success.html`;
    const webhookUrl = `${protocol}://${host}/api/webhook`;
    
    console.log('Redirect URL:', redirectUrl);
    console.log('Webhook URL:', webhookUrl);

    console.log('🔄 Creating payment in SPWorlds...');
    const response = await fetch('https://spworlds.ru/api/public/payments', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${base64Auth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      },
      body: JSON.stringify({
        items: [{ 
          name: "Поддержка SPMTV", 
          count: 1, 
          price: parseInt(amount) 
        }],
        redirectUrl: redirectUrl,
        webhookUrl: webhookUrl,
        data: String(discordId)
      })
    });

    const responseText = await response.text();
    console.log('SPWorlds response status:', response.status);
    console.log('SPWorlds response:', responseText);

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.error('❌ Failed to parse SPWorlds response');
      throw new Error('Invalid response from SPWorlds');
    }
    
    // Сохраняем данные в Google Sheet
    if (data.url) {
      try {
        await addRowToSheet({
          discordId,
          discordNick: discordNick || userNick,
          minecraftNick: minecraftNick || 'Не указан',
          question: question || '',
          category: category || '',
          supportType: supportType || 'unknown',
          amount,
          paymentStatus: 'Ожидание'
        });
      } catch (sheetError) {
        console.error('⚠️ Не удалось сохранить в Google Sheet:', sheetError);
        // Не прерываем выполнение, платёж важнее
      }
    }
    
    console.log('✅ Payment created:', data.url);
    res.status(200).json(data);
    
  } catch (error) {
    console.error('❌ Create payment error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/webhook', (req, res) => {
  console.log('📨 Webhook received');
  
  const signature = req.headers['x-body-hash'];
  console.log('Signature:', signature);
  
  const hmac = crypto.createHmac('sha256', process.env.SP_TOKEN);
  hmac.update(JSON.stringify(req.body));
  const myHash = hmac.digest('base64');

  if (myHash !== signature) {
    console.error('❌ Invalid webhook signature');
    return res.status(401).send('Fake');
  }

  console.log('✅ PAYMENT CONFIRMED!');
  console.log('Payer:', req.body.payer);
  console.log('Amount:', req.body.amount);
  console.log('Discord ID:', req.body.data);
  
  // Обновляем статус в Google Sheet
  updatePaymentStatus(
    req.body.data, 
    req.body.amount.toString(), 
    'Оплачено'
  ).catch(err => console.error('⚠️ Ошибка обновления статуса:', err));
  
  res.status(200).send('OK');
});

// 404 handler
app.use((req, res) => {
  console.log('❌ 404 Not Found:', req.method, req.path);
  res.status(404).send('Not Found');
});

// ============ ЗАПУСК ============
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📋 Environment:`, {
    DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
    REDIRECT_URI: process.env.REDIRECT_URI,
    SP_CARD_ID: process.env.SP_CARD_ID ? 'Set' : 'Not set',
    SP_TOKEN: process.env.SP_TOKEN ? 'Set' : 'Not set'
  });
});