#!/bin/sh
set -eu

server_name="${NGINX_SERVER_NAME:-localhost}"
runtime_cert_dir="/etc/nginx/runtime-certs"
letsencrypt_cert="/etc/letsencrypt/live/${server_name}/fullchain.pem"
letsencrypt_key="/etc/letsencrypt/live/${server_name}/privkey.pem"
reload_interval="${NGINX_CERT_RELOAD_INTERVAL_SECONDS:-300}"

mkdir -p "$runtime_cert_dir"

install_letsencrypt_certificate() {
  if [ -s "$letsencrypt_cert" ] && [ -s "$letsencrypt_key" ]; then
    ln -sf "$letsencrypt_cert" "$runtime_cert_dir/fullchain.pem"
    ln -sf "$letsencrypt_key" "$runtime_cert_dir/privkey.pem"
    return 0
  fi

  return 1
}

create_temporary_certificate() {
  if [ -s "$runtime_cert_dir/fullchain.pem" ] && [ -s "$runtime_cert_dir/privkey.pem" ]; then
    return
  fi

  echo "Creating temporary self-signed TLS certificate for ${server_name}."
  openssl req \
    -x509 \
    -nodes \
    -newkey rsa:2048 \
    -days 1 \
    -keyout "$runtime_cert_dir/privkey.pem" \
    -out "$runtime_cert_dir/fullchain.pem" \
    -subj "/CN=${server_name}" >/dev/null 2>&1
}

if ! install_letsencrypt_certificate; then
  create_temporary_certificate
fi


if [ "$reload_interval" != "0" ]; then
  (
    while :; do
      sleep "$reload_interval"
      if install_letsencrypt_certificate; then
        nginx -s reload || true
      fi
    done
  ) &
fi