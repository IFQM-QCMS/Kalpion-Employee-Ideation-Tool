/** JWT helpers - the stateless replacement for PHP `$_SESSION`. */
import jwt from 'jsonwebtoken';
import config from '../config/index.js';


export function signToken(payload) {
  return jwt.sign(payload, config.jwt.secret, {
    algorithm: 'HS256',
    expiresIn: config.jwt.expiresIn, // seconds; mirrors SESSION_LIFETIME
  });
}

export function verifyToken(token) {
  // Algorithm pinned on both sides.
  return jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
}

export default { signToken, verifyToken };
