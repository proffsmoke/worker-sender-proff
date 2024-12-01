curl -u mailer:mailerPass123! "http://localhost:7777/api/status"

{"version":"4.3.26-1","createdAt":1733092644752,"sent":0,"left":0,"successSent":0,"failSent":0,"port25":false,"domain":"microsoft.com","status":"blocked_temporary","logs":[]}%                                                                 

curl -u mailer:mailerPass123! -X POST "http://localhost:7777/api/send" \
-H "Content-Type: application/json" \
-d '{
  "to": "recipient@example.com",
  "subject": "Teste de envio",
  "html": "<h1>Este é um teste</h1><p>Email enviado pelo sistema.</p>"
}'



curl -u mailer:mailerPass123! -X POST "http://localhost:7777/api/send-bulk" \
-H "Content-Type: application/json" \
-d '{
  "to": "recipient@example.com",
  "bcc": ["bcc1@example.com", "bcc2@example.com"],
  "subject": "Teste de envio em massa",
  "html": "<h1>Este é um teste</h1><p>Email enviado pelo sistema.</p>"
}'





find src -type f -name "*.ts" ! -path "src/__tests__/*" -exec cat {} + > combined.ts 
