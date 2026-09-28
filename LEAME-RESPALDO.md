# Respaldo de JB Termómetro Bursátil y NUMINI SHOP

Este respaldo contiene:

- `artifacts/jb-termometro-bursatil-live`: aplicación web del Termómetro.
- `artifacts/inventario-caja`: aplicación web NUMINI SHOP.
- `artifacts/api-server`: API compartida.
- `lib`: contratos OpenAPI, clientes generados y esquema PostgreSQL.
- `database/jb-numini-postgresql.dump`: copia PostgreSQL en formato `pg_dump` custom.

No contiene contraseñas, claves Clerk, secretos de sesión ni credenciales de servicios.

## Restauración básica

1. Instalar Node.js y pnpm.
2. Ejecutar `pnpm install` en la raíz.
3. Crear una base PostgreSQL vacía y definir `DATABASE_URL` en el servidor.
4. Restaurar los datos con `pg_restore --no-owner --no-acl --dbname="$DATABASE_URL" database/jb-numini-postgresql.dump`.
5. Configurar nuevamente Clerk y App Storage mediante variables secretas del servidor.
6. Ejecutar los servicios web y API usando los scripts de sus respectivos `package.json`.

## Importante

Los objetos binarios alojados en Replit App Storage no están dentro de este ZIP. Sus rutas y metadatos sí permanecen en PostgreSQL, pero los archivos deben exportarse por separado si ya existen fotografías cargadas.
