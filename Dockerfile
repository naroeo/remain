FROM node:22-bookworm

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive

# Chromium 有头模式需要虚拟显示器
RUN apt-get update && apt-get install -y \
    xvfb \
    fluxbox \
    dbus-x11 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 安装最新版 rclone
RUN curl https://rclone.org/install.sh | bash && \
    rclone version

COPY package*.json ./

RUN npm install

# 安装 Playwright Chromium 及运行依赖
RUN npx playwright install --with-deps chromium

COPY src ./src
COPY public ./public

RUN mkdir -p /tmp/remain-data/browser

ENV PORT=3000
ENV NODE_ENV=production
ENV DISPLAY=:99
ENV DATA_DIR=/tmp/remain-data

EXPOSE 3000

CMD ["npm", "start"]
