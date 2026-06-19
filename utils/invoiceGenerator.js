const PDFDocument = require('pdfkit');
const { calculateDays } = require('./helpers');

const COMPANY = {
  name: 'RentGear',
  address: '123 Rental Ave, Kathmandu, Nepal',
  email: 'support@rentgear.com',
  phone: '+977-1-4000000',
};

const SERVICE_FEE_RATE = 0.05;

// Build a plain invoice data object from a booking (+ optional payment).
function buildInvoiceData(booking, payment) {
  const equipment = booking.equipment || {};
  const user = booking.user || {};

  const dailyRate = equipment.dailyRate || 0;
  const days = calculateDays(booking.startDate, booking.endDate);
  const subtotal = booking.totalPrice || dailyRate * days;
  const serviceFee = Math.round(subtotal * SERVICE_FEE_RATE * 100) / 100;
  const deposit = booking.deposit || 0;
  const lateFee = booking.lateFee || 0;
  const total = subtotal + serviceFee + deposit + lateFee;

  const idTail = booking._id.toString().slice(-4).toUpperCase();

  return {
    invoiceNumber: `INV-${Date.now()}-${idTail}`,
    issueDate: booking.createdAt,
    dueDate: booking.startDate,
    bookingRef: `#BK-${idTail}`,
    customer: {
      name: user.name || '',
      email: user.email || '',
      phone: user.phone || '',
      address: user.address || '',
    },
    equipment: {
      name: equipment.name || 'Equipment',
      category: equipment.category || '',
      image: equipment.image || null,
    },
    rentalPeriod: {
      startDate: booking.startDate,
      endDate: booking.endDate,
      days,
    },
    priceBreakdown: {
      dailyRate,
      days,
      subtotal,
      serviceFee,
      deposit,
      lateFee,
    },
    total,
    payment: {
      status: payment ? payment.status : 'unpaid',
      method: payment ? payment.method : null,
      transactionId: payment ? payment.transactionId : null,
    },
    company: COMPANY,
  };
}

const money = (n) => `$${Number(n).toFixed(2)}`;
const fmtDate = (d) =>
  new Date(d).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

// Stream a formatted PDF invoice to an Express response.
function streamInvoicePDF(invoice, res) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${invoice.invoiceNumber}.pdf"`
  );
  doc.pipe(res);

  // Header
  doc.fontSize(24).fillColor('#6366f1').text(invoice.company.name, { continued: false });
  doc.fontSize(10).fillColor('#475569').text(invoice.company.address);
  doc.text(`${invoice.company.email}  |  ${invoice.company.phone}`);
  doc.moveDown();

  doc.fillColor('#0f172a').fontSize(18).text('INVOICE', { align: 'right' });
  doc
    .fontSize(10)
    .fillColor('#475569')
    .text(invoice.invoiceNumber, { align: 'right' })
    .text(`Issued: ${fmtDate(invoice.issueDate)}`, { align: 'right' })
    .text(`Due: ${fmtDate(invoice.dueDate)}`, { align: 'right' })
    .text(`Ref: ${invoice.bookingRef}`, { align: 'right' });

  doc.moveDown(2);

  // Bill To
  doc.fillColor('#0f172a').fontSize(12).text('Bill To');
  doc
    .fontSize(10)
    .fillColor('#475569')
    .text(invoice.customer.name)
    .text(invoice.customer.email)
    .text(invoice.customer.phone || '')
    .text(invoice.customer.address || '');

  doc.moveDown(1.5);

  // Equipment + rental period
  doc.fillColor('#0f172a').fontSize(12).text('Rental Details');
  doc
    .fontSize(10)
    .fillColor('#475569')
    .text(`Equipment: ${invoice.equipment.name} (${invoice.equipment.category})`)
    .text(
      `Period: ${fmtDate(invoice.rentalPeriod.startDate)} - ${fmtDate(
        invoice.rentalPeriod.endDate
      )} (${invoice.rentalPeriod.days} day(s))`
    );

  doc.moveDown(1.5);

  // Price breakdown
  const pb = invoice.priceBreakdown;
  const rows = [
    [`Rental (${money(pb.dailyRate)} x ${pb.days} day(s))`, money(pb.subtotal)],
    ['Service fee (5%)', money(pb.serviceFee)],
    ['Deposit (refundable)', money(pb.deposit)],
  ];
  if (pb.lateFee > 0) rows.push(['Late fee', money(pb.lateFee)]);

  doc.fillColor('#0f172a').fontSize(12).text('Price Breakdown');
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor('#475569');
  const labelX = 50;
  const valueX = 400;
  rows.forEach(([label, value]) => {
    const y = doc.y;
    doc.text(label, labelX, y);
    doc.text(value, valueX, y, { align: 'right', width: 100 });
    doc.moveDown(0.4);
  });

  doc.moveDown(0.5);
  const ty = doc.y;
  doc.fillColor('#0f172a').fontSize(13).text('Total', labelX, ty);
  doc.text(money(invoice.total), valueX, ty, { align: 'right', width: 100 });

  doc.moveDown(2);

  // Payment status
  doc
    .fontSize(10)
    .fillColor('#475569')
    .text(
      `Payment: ${invoice.payment.status}${
        invoice.payment.method ? ` (${invoice.payment.method})` : ''
      }`
    );
  if (invoice.payment.transactionId) {
    doc.text(`Transaction: ${invoice.payment.transactionId}`);
  }

  // Footer
  doc.moveDown(3);
  doc
    .fontSize(9)
    .fillColor('#94a3b8')
    .text(
      'Thank you for renting with RentGear. The deposit is refundable upon return of the equipment in good condition. For questions, contact support@rentgear.com.',
      { align: 'center' }
    );

  doc.end();
}

module.exports = { buildInvoiceData, streamInvoicePDF };
