export default function RepairSettings({ shop }) {
  return (
    <div>
      <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#1c1917', margin: '0 0 4px' }}>Repair Division Settings</h1>
      <p style={{ color: '#8a7a63', fontSize: '14px', margin: '0 0 22px' }}>Configuration for this division {shop ? `— ${shop.name}` : ''}</p>

      <div style={{ background: 'white', borderRadius: '16px', padding: '24px', border: '1px solid #f3ede4', maxWidth: '520px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: '800', color: '#1c1917', margin: '0 0 14px' }}>About the Repair Division</h3>
        <p style={{ fontSize: '13px', color: '#57534e', lineHeight: '1.6', margin: '0 0 12px' }}>
          This division operates independently from Phonefix's retail system — its own customers, inventory, purchases, sales, expenses, and cash account.
        </p>
        <p style={{ fontSize: '13px', color: '#57534e', lineHeight: '1.6', margin: 0 }}>
          The only connection to the main retail accounting is <strong>Bank Deposits</strong> (Cash & Deposits page) — depositing repair cash into one of Phonefix's existing bank accounts. Everything else stays fully separate.
        </p>
      </div>
    </div>
  )
}
