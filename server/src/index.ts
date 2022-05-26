import App from '@/app';
import HealthRoute from '@routes/health.route';
import WebhookRoute from '@routes/webhook.route';
import validateEnv from '@utils/validateEnv';
import AuthRoute from '@routes/auth.route';

validateEnv();

const app = new App([new WebhookRoute(), new HealthRoute(), new AuthRoute()]);

app.listen();
