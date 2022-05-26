import { Router } from 'express';
import { Routes } from '@interfaces/routes.interface';
import AuthController from '@controllers/auth.controller';
import passport from 'passport';

class AuthRoute implements Routes {
  public path = '/api/mailchimp';
  public router = Router();
  public authController = new AuthController();

  constructor() {
    this.initializeRoutes();
  }

  private initializeRoutes() {
    this.router.get(`${this.path}/auth`, this.authController.auth);
    this.router.get(`${this.path}/auth/callback/failure`, this.authController.authFailure);
    this.router.get(`${this.path}/auth/callback`, passport.authorize('mailchimp', { failureRedirect: `${this.path}/auth/callback/failure` }), this.authController.authCallback);
  }
}

export default AuthRoute;
