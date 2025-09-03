# VPS Setup

Fresh Ubuntu VPS to production deployment.

## Install Dependencies

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Install Certbot
sudo apt install -y certbot

# Firewall
sudo ufw allow ssh
sudo ufw allow 80
sudo ufw allow 443
sudo ufw --force enable

# Logout and login to apply docker group
```

## Deploy Application

```bash
# Clone repository
git clone <your-repo-url>
cd greflect

# Configure environment
cp .env.example .env
nano .env  # Add your API keys

# Configure domain
sed -i 's/your-domain.com/yourdomain.com/g' nginx.conf .env

# Create SSL directory
mkdir ssl

# Get SSL certificate
sudo certbot certonly --standalone -d yourdomain.com
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem ssl/
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem ssl/
sudo chown $USER:$USER ssl/*.pem

# Start services
docker-compose up -d

# Check status
docker-compose ps
docker-compose logs
```

## Maintenance

```bash
# View logs
docker-compose logs -f

# Restart service
docker-compose restart web

# Update application
git pull && docker-compose up -d --build

# Backup database
docker-compose exec postgres pg_dump -U greflect greflect > backup-$(date +%Y%m%d).sql

# SSL renewal (add to crontab)
sudo certbot renew --quiet && docker-compose restart nginx
```

## DNS Configuration

Point your domain A record to the VPS IP:

```
yourdomain.com    A    123.456.789.101
```

## Security

- Database and Qdrant are internal only
- API accessible only through nginx proxy
- Rate limiting enabled
- Security headers configured
- SSL/TLS enforced