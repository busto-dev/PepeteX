FROM nginx:1.27-alpine

RUN apk add --no-cache openssl

COPY deploy/nginx/templates /etc/nginx/templates
COPY deploy/nginx/docker-entrypoint.d /docker-entrypoint.d

RUN chmod +x /docker-entrypoint.d/*.sh