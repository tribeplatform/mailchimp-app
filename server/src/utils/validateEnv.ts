import { cleanEnv, port, str } from 'envalid';

const validateEnv = () => {
  cleanEnv(process.env, {
    NODE_ENV: str(),
    PORT: port(),
    CLIENT_ID: str(),
    CLIENT_SECRET: str(),
    SIGNING_SECRET: str(),
    MAILCHIMP_CLIENT_ID: str(),
    MAILCHIMP_CLIENT_SECRET: str(),
  });
};

export default validateEnv;
