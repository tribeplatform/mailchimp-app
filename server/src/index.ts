import { config } from 'dotenv';
import validateEnv from '@utils/validateEnv';
config({ path: `.env` });
validateEnv();

import '@utils/tracer'
import App from '@/app';
import HealthRoute from '@routes/health.route';
import WebhookRoute from '@routes/webhook.route';
import AuthRoute from '@routes/auth.route';

const app = new App([new WebhookRoute(), new HealthRoute(), new AuthRoute()]);

app.listen();
