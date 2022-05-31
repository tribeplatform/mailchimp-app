import { CLIENT_ID, CLIENT_SECRET, GRAPHQL_URL, MAILCHIMP_CLIENT_ID, MAILCHIMP_CLIENT_SECRET, SERVER_URL } from '@config';

import passport from 'passport';
import express from 'express';
import { logger } from '@/utils/logger';
import { Strategy as MailchimpStrategy } from 'passport-mailchimp';
import MailchimpModel from '@/models/mailchimp.model';
import { GlobalClient } from '@tribeplatform/gql-client';
const init = (app: express.Application) => {
  passport.use(
    new MailchimpStrategy(
      {
        name: 'mailchimp',
        clientID: MAILCHIMP_CLIENT_ID,
        clientSecret: MAILCHIMP_CLIENT_SECRET,
        passReqToCallback: true,
        callbackURL: `${SERVER_URL}/api/mailchimp/auth/callback`,
      },
      async (req: express.Request, accessToken: string, refreshToken: string, profile, done) => {
        try {
          let buff = Buffer.from(String(req.query.state), 'base64');
          const { n: networkId, m: memberId } = JSON.parse(buff.toString('ascii')) as { n: string; m: string; s: string };
          const { _json } = profile;
          const mailchimp = await MailchimpModel.findOneAndReplace(
            { networkId },
            {
              name: _json.accountname,
              connectedBy: memberId,
              networkId,
              accessToken,
              dataCentre: _json.dc,
              apiEndpoint: _json.api_endpoint,
            },
            {
              upsert: true,
              returnDocument: 'after',
            },
          );
          done(null, mailchimp);
        } catch (err) {
          logger.error('An error occured during the SlackStrategy handling');
          logger.error(err);
          done(err, {});
        }
      },
    ),
  );
  app.use(passport.initialize());
};

export default {
  init,
};
