import { MAILCHIMP_CLIENT_ID, MAILCHIMP_CLIENT_SECRET, SERVER_URL } from '@config';

import passport from 'passport';
import express from 'express';
import { logger } from '@/utils/logger';
import { Strategy as MailchimpStrategy } from 'passport-mailchimp';
import MailchimpModel from '@/models/mailchimp.model';
import { verifyOAuthState } from '@/utils/oauthState';

export const handleMailchimpAuthorization = async (req: express.Request, accessToken: string, refreshToken: string, profile, done) => {
  try {
    const state = verifyOAuthState(req.query.state);
    if (!state) {
      logger.error('Rejected Mailchimp authorization with an invalid state');
      return done(null, false, { message: 'Invalid authorization state' });
    }
    const { networkId, memberId } = state;
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
    logger.error('An error occured during the MailchimpStrategy handling');
    logger.error(err);
    done(err, {});
  }
};

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
      handleMailchimpAuthorization,
    ),
  );
  app.use(passport.initialize());
};

export default {
  init,
};
