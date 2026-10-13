# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is enabled on this template. See [this documentation](https://react.dev/learn/react-compiler) for more information.

Note: This will impact Vite dev & build performances.

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.
## Workout Guide attribution

AveFit bundles the exercise illustrations from the included `workout-guide-main` repository. The visual assets are licensed under **CC BY-SA 4.0**; attribution is to **Bryl Lim**, with original source artwork from **Everkinetic** as identified by the repository manifest.

## Google sign-in

Set `VITE_GOOGLE_CLIENT_ID` in `client/.env` and the matching `GOOGLE_CLIENT_ID` in `server/.env` using a Google OAuth web client ID. Add the frontend URL (for example, `http://localhost:5173`) to that client's authorized JavaScript origins. New Google signups must provide a phone number and accept the Terms; their verified email skips the email-code step, but the account still requires gym approval.

## Browser push notifications

Push notifications require a secure origin (HTTPS in deployment; `localhost` is allowed for local development) and VAPID keys configured in `server/.env`. Generate a key pair from the `server` directory with `npx web-push generate-vapid-keys`, then set `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, and optionally `WEB_PUSH_CONTACT` (a `mailto:` address). Keep the private key secret. Users, coaches, and admins enable browser delivery from their Notifications page; in-app notifications do not require browser permission.
