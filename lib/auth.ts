import jwt from 'jsonwebtoken';
import Err from '@openaddresses/batch-error';
import type { Request, Response, NextFunction } from 'express';
import type Config from './config.js';

export interface SessionPayload {
    sub: string;        // CloudTAK username/email
    access?: string;    // CloudTAK access level
    cloudtak_token: string; // upstream bearer used to call the CloudTAK API
}

export function sign(config: Config, payload: SessionPayload): string {
    return jwt.sign(payload, config.SigningSecret, {
        expiresIn: '12h'
    });
}

export function verify(config: Config, token: string): SessionPayload {
    try {
        return jwt.verify(token, config.SigningSecret) as SessionPayload;
    } catch (err) {
        throw new Err(401, err instanceof Error ? err : null, 'Invalid or expired token');
    }
}

/**
 * Express middleware that verifies an `Authorization: Bearer <jwt>` header
 * issued by this server (NOT a raw CloudTAK token). Attaches `req.session`.
 */
export function authn(config: Config) {
    return function (req: Request, _res: Response, next: NextFunction) {
        const header = req.headers['authorization'];
        if (!header || !header.startsWith('Bearer ')) {
            return next(new Err(401, null, 'Authentication Required'));
        }

        const token = header.slice('Bearer '.length).trim();
        const session = verify(config, token);

        // attach to request via mutation (avoids needing a global type augmentation)
        (req as Request & { session: SessionPayload }).session = session;
        return next();
    }
}
