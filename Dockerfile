FROM node:22-bookworm

WORKDIR /app

COPY package*.json ./

RUN npm install

RUN npx playwright install --with-deps chromium

COPY src ./src
COPY public ./public

RUN mkdir -p /app/data/browser

ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

CMD ["npm", "start"]
