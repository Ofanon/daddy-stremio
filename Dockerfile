FROM node:24-alpine
RUN apk add --no-cache ffmpeg
ENV NODE_ENV=production HOST=0.0.0.0 PORT=7000
WORKDIR /app
COPY --chown=node:node package.json server.mjs ./
USER node
EXPOSE 7000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:7000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
