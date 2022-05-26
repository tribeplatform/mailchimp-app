import { NextFunction, Request, Response } from 'express';
import passport from 'passport';
import authUtil from '@utils/auth';

class AuthController {
  public auth = async (req: Request, res: Response, next: NextFunction) => {
    const { jwt, redirect = '/' } = req.query;
    if (!jwt) {
      res.status(400).json({ success: false, message: '"jwt" is a mandatory param.' });
      return;
    }
    try {
      const decodedJwt = authUtil.verify(jwt as string) as any;
      if (!decodedJwt || !decodedJwt.sub) {
        res.status(403).json({ success: false, message: `You don't have access to this page.` });
        return;
      }
      const state = Buffer.from(JSON.stringify({ n: decodedJwt.sub, m: decodedJwt.usr, r: redirect }), 'ascii').toString('base64');
      passport.authorize('mailchimp', {
        state,
      })(req, res, next);
    } catch (error) {
      next(error);
    }
  };
  public authCallback = async (req: Request, res: Response, next: NextFunction) => {
    try {
      let buff = Buffer.from(String(req.query.state), 'base64');
      const { r: redirect } = JSON.parse(buff.toString('ascii')) as { r: string };

      if (!!redirect) {
        return res.redirect(redirect);
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
      let buff = Buffer.from(String(req.query.state), 'base64');
      const { r: redirect } = JSON.parse(buff.toString('ascii')) as { r: string };
      if (!!redirect) {
        return res.redirect(redirect);
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
