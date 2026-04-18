import express from 'express';
import dotenv from 'dotenv';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

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
  const url = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&scope=identify`;
  res.redirect(url);
});

app.get('/api/auth/callback', async (req, res) => {
  const { code } = req.query;
  
  try {
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

    if (!tokenData.access_token) {
      throw new Error('Не удалось получить access_token');
    }

    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userData = await userResponse.json();

    let avatarUrl = null;
    if (userData.avatar) {
      avatarUrl = `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`;
    }

    const avatarParam = avatarUrl ? `&avatar=${encodeURIComponent(avatarUrl)}` : '';
    res.redirect(`/?id=${userData.id}&nick=${userData.username}${avatarParam}`);
  } catch (error) {
    console.error('Ошибка авторизации:', error);
    res.status(500).send('Ошибка авторизации через Discord');
  }
});

// ============ SPWORLDS API ============
app.get('/api/get-user', async (req, res) => {
  const { id } = req.query;
  
  try {
    const authString = `${process.env.SP_CARD_ID}:${process.env.SP_TOKEN}`;
    const base64Auth = Buffer.from(authString).toString('base64');
    
    const response = await fetch(`https://spworlds.ru/api/public/users/${id}`, {
      headers: { 
        'Authorization': `Bearer ${base64Auth}`,
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      }
    });
    
    const data = await response.json();
    res.status(200).json(data);
    
  } catch (error) {
    console.error('Ошибка получения пользователя:', error);
    res.status(200).json({ username: null });
  }
});

app.post('/api/create-pay', async (req, res) => {
  try {
    const { amount, discordId } = req.body;

    const authString = `${process.env.SP_CARD_ID}:${process.env.SP_TOKEN}`;
    const base64Auth = Buffer.from(authString).toString('base64');

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');

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
        redirectUrl: `${protocol}://${host}/success.html`,
        webhookUrl: `${protocol}://${host}/api/webhook`,
        data: String(discordId)
      })
    });

    const data = await response.json();
    res.status(200).json(data);
    
  } catch (error) {
    console.error('Ошибка создания платежа:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/webhook', (req, res) => {
  const signature = req.headers['x-body-hash'];
  
  const hmac = crypto.createHmac('sha256', process.env.SP_TOKEN);
  hmac.update(JSON.stringify(req.body));
  const myHash = hmac.digest('base64');

  if (myHash !== signature) {
    console.error('Неверная подпись вебхука');
    return res.status(401).send('Fake');
  }

  console.log('✅ ОПЛАТА ПОДТВЕРЖДЕНА!');
  console.log('Оплатил:', req.body.payer);
  console.log('Сумма:', req.body.amount);
  console.log('Discord ID:', req.body.data);
  
  res.status(200).send('OK');
});

// ============ ЗАПУСК ============
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
});