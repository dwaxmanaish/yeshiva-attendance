import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import session from 'express-session';
import salesforceRouter from './routes/salesforce.js';

const app = express();
const port = process.env.PORT || 3000;

app.set('trust proxy', 1);

const corsOrigin = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true;
app.use(helmet());
app.use(cors({ origin: corsOrigin, credentials: corsOrigin !== true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(compression());
app.use(morgan('dev'));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

// Bearer token auth middleware
app.use((req, res, next) => {
  const expected = (process.env.API_BEARER_TOKEN || '').trim();
  if (!expected) return res.status(500).json({ error: 'Server misconfigured: API_BEARER_TOKEN is not set' });
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (token && token === expected) return next();
  return res.status(401).json({ error: 'Unauthorized' });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api', salesforceRouter);

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
