const test = require('node:test');
const assert = require('node:assert/strict');
const { generateEmploymentApplicationPdf } = require('../services/pdf.service');

test('generateEmploymentApplicationPdf returns non-empty PDF buffer', async () => {
  const buf = await generateEmploymentApplicationPdf({
    application_date: '2026-03-11',
    applicant_snapshot: {
      firstName: 'Jane',
      lastName: 'Driver',
      phone: '555-555-5555',
      email: 'jane@example.com',
      legalRightToWorkInUS: true,
      applicantPrintedName: 'Jane Driver',
      signatureDate: '2026-03-11'
    },
    residencies: [{ residencyType: 'Current', street: '123 Main', city: 'Dallas', state: 'TX', zipCode: '75001', yearsAtAddress: '2' }],
    licenses: [{ state: 'TX', licenseNumber: 'X12345', licenseClassOrType: 'A', endorsements: 'N', expirationDate: '2028-01-01' }],
    drivingExperience: [{ classOfEquipment: 'Tractor & Semi-Trailer', typeOfEquipment: 'Van', dateFrom: '2020-01-01', dateTo: '2025-01-01', approximateMilesTotal: '500000' }],
    accidents: [],
    convictions: [],
    employers: [{ companyName: 'ABC Logistics', fromMonthYear: '01/2022', toMonthYear: '12/2024' }],
    education: [{ schoolType: 'High School', schoolNameAndLocation: 'HS, TX', courseOfStudy: 'General', yearsCompleted: '4', graduated: 'Y', details: '' }]
  });

  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 1000);
  assert.equal(String(buf.slice(0, 4)), '%PDF');
});
