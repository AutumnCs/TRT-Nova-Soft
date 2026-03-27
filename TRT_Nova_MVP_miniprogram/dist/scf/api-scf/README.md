# api-scf

Mini program API -> MySQL

## Files

- `index.js`: SCF entry file
- `.env.example`: environment variable template
- `package.json`: deploy-time dependencies

## Deploy

1. Run `npm install` in this folder
2. Fill the SCF environment variables in Tencent Cloud console
3. Upload this folder to SCF and set handler to `index.main` or `index.main_handler`

