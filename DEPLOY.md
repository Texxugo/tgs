# Deploy de ProduÃ§Ã£o

## 1. PrÃ©-requisitos
- Node.js 20+
- NPM 10+
- HTTPS no domÃ­nio (proxy reverso/plataforma)

## 2. ConfiguraÃ§Ã£o
1. Copie `.env.example` para `.env`.
2. Preencha:
- `NODE_ENV=production`
- `HOST=0.0.0.0`
- `PORT` da aplicaÃ§Ã£o
- `PUBLIC_API_URL` com a URL pÃºblica da API
- `DATABASE_URL` do PostgreSQL do servidor
- `DB_SSL` e `DB_SSL_REJECT_UNAUTHORIZED` conforme provedor (quando usar TLS)
- `JWT_SECRET` forte (64+ chars)
- `CORS_ORIGINS` com os domÃ­nios reais do frontend
- `TRUST_PROXY` conforme infra

## 3. Frontend
1. Se frontend e API ficarem no mesmo domÃ­nio com proxy reverso em `/api`, o frontend passa a funcionar automaticamente.
2. Se o frontend ficar em outro domÃ­nio/subdomÃ­nio, edite `sistema-ponto-frontend/config.js` e defina:
```js
window.__APP_CONFIG__ = {
  apiBase: "https://api.seudominio.com/api",
};
```
3. Garanta que esse domÃ­nio tambÃ©m esteja em `CORS_ORIGINS`.

## 4. Banco e usuÃ¡rio admin
1. Rodar migrations:
```bash
npm run migrate
```
2. Criar admin inicial:
```bash
npm run create:admin
```

## 5. Subir API
```bash
npm ci --omit=dev
npm run start:prod
```

## 6. Checklist de validaÃ§Ã£o (smoke test)
1. `GET /health` retorna `{ ok: true }`.
2. Login com admin funciona.
3. `GET /me` retorna usuÃ¡rio autenticado.
4. Bater ponto IN/OUT funciona.
5. Admin lista usuÃ¡rios e altera status.
6. Admin lista/resolve alertas.
7. CORS bloqueia origem nÃ£o permitida.

## 7. OperaÃ§Ã£o recomendada
1. Rodar com gerenciador de processo (PM2/systemd/container).
2. Fazer backup periódico do banco PostgreSQL.
3. Rotacionar logs e monitorar `/health`.



