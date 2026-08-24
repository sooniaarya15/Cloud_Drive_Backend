import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { query } from "../db/pool.js";

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value?.toLowerCase();
        const name = profile.displayName;
        const imageUrl = profile.photos?.[0]?.value;

        if (!email) return done(new Error("No email returned by Google"), null);

        const existing = await query("SELECT * FROM users WHERE email = $1", [email]);

        let user;
        if (existing.rowCount > 0) {
          user = existing.rows[0];
        } else {
          const inserted = await query(
            `INSERT INTO users (name, email, auth_provider, image_url)
             VALUES ($1, $2, 'GOOGLE', $3)
             RETURNING *`,
            [name, email, imageUrl]
          );
          user = inserted.rows[0];
        }

        return done(null, user);
      } catch (err) {
        return done(err, null);
      }
    }
  )
);

export default passport;