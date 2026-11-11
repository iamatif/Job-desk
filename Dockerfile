FROM node:24-bookworm
WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright JOBDESK_DATA_DIR=/app/data JOBDESK_HEADLESS=true HOST=0.0.0.0
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npx playwright install --with-deps chromium
COPY --chown=node:node . .
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 4180
CMD ["node", "server.mjs"]
