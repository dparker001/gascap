import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { sendMail, accountDeletedEmailHtml } from '../lib/email';

async function main() {
  await sendMail({
    to:      'lanecarlee088@gmail.com',
    subject: 'Your GasCap™ account has been deleted',
    html:    accountDeletedEmailHtml('Carlee Lane'),
    text:    'Hi Carlee, your GasCap™ account has been permanently deleted as requested. Before you go — mind sharing why you decided to delete your account? Just hit reply. We read every response. If this was done in error, please reply immediately. — The GasCap™ Team',
  });
  console.log('✅ Deletion confirmation sent to lanecarlee088@gmail.com');
}

main().catch((err) => { console.error('Failed:', err); process.exit(1); });
