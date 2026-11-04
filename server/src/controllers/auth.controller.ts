import { NextFunction, Request, Response } from 'express';
import passport from 'passport';
import { GlobalClient } from '@tribeplatform/gql-client';
import { CLIENT_ID, CLIENT_SECRET, GRAPHQL_URL } from '@config';
import authUtil from '@utils/auth';
import { createOAuthState, isSafeStoredRedirect, sanitizeRedirect, verifyOAuthState } from '@utils/oauthState';
import { createLogger } from '@utils/logger';

const logger = createLogger('AuthController');

const getNetworkDomain = async (networkId: string): Promise<string | undefined> => {
  try {
    const tribeClient = await new GlobalClient({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      graphqlUrl: GRAPHQL_URL,
    }).getTribeClient({ networkId });
    const network = await tribeClient.network.get('basic');
    return network?.domain;
  } catch (err) {
    logger.error(`Could not load network domain for ${networkId}`);
    return undefined;
  }
};

class AuthController {
  public auth = async (req: Request, res: Response, next: NextFunction) => {
    const { jwt, redirect = '/' } = req.query;
    if (!jwt) {
      res.status(400).json({ success: false, message: '"jwt" is a mandatory param.' });
      return;
    }
    let decodedJwt: any;
    try {
      decodedJwt = authUtil.verify(jwt as string);
    } catch (err) {
      decodedJwt = null;
    }
    if (!decodedJwt || typeof decodedJwt.sub !== 'string' || !decodedJwt.sub) {
      res.status(403).json({ success: false, message: `You don't have access to this page.` });
      return;
    }
    try {
      const networkId: string = decodedJwt.sub;
      const networkDomain = typeof redirect === 'string' && !redirect.startsWith('/') ? await getNetworkDomain(networkId) : undefined;
      const state = createOAuthState({
        networkId,
        memberId: decodedJwt.usr,
        redirect: sanitizeRedirect(redirect, networkDomain),
      });
      passport.authorize('mailchimp', {
        state,
      })(req, res, next);
    } catch (error) {
      next(error);
    }
  };

  /**
   * Rejects the OAuth callback before the authorization code is exchanged
   * unless it carries a state value signed by this app.
   */
  public verifyCallbackState = (req: Request, res: Response, next: NextFunction) => {
    const state = verifyOAuthState(req.query.state);
    if (!state) {
      res.status(403).json({ success: false, message: 'Invalid or expired authorization state. Please try connecting again.' });
      return;
    }
    res.locals.oauthState = state;
    next();
  };

  public authCallback = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const state = res.locals.oauthState || verifyOAuthState(req.query.state);
      if (state && isSafeStoredRedirect(state.redirect)) {
        return res.redirect(state.redirect);
      }

      res.status(200).json({
        success: true,
      });
    } catch (error) {
      next(error);
    }
  };

  public authFailure = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const state = verifyOAuthState(req.query.state);
      if (state && isSafeStoredRedirect(state.redirect)) {
        return res.redirect(state.redirect);
      }
      res.status(200).json({
        success: false,
      });
    } catch (error) {
      next(error);
    }
  };
}

export default AuthController;
