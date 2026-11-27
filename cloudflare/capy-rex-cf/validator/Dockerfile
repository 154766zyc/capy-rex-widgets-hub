FROM node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530
WORKDIR /checker
COPY --chown=node:node nas/vendor/ nas/vendor/
COPY --chown=node:node nas/validation.mjs nas/validation.mjs
COPY --chown=node:node nas/style.css nas/style.css
COPY --chown=node:node metadata.js metadata.js
COPY --chown=node:node validator/ validator/
COPY --chown=node:node public/app-icons/ public/app-icons/
ENV PORT=8080
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8080/checker').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","--max-old-space-size=64","validator/server.mjs"]
