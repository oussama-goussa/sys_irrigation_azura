#!/bin/sh
echo "Azura Backend - Demarrage..."

echo "Attente PostgreSQL..."
while ! pg_isready -h db -U azura_user -d azura_irrigation > /dev/null 2>&1; do
    sleep 1
done
echo "PostgreSQL pret !"

echo "Application des migrations..."
alembic upgrade head
echo "Migrations appliquees !"

echo "Demarrage FastAPI..."
exec uvicorn main:app --host 0.0.0.0 --port 8000 --reload
