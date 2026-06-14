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

// FN-1834: exercise the new render paths — operating-entity header, current+previous
// residencies, a long employer name (truncation), work-auth answers (adverse coloring),
// and the audit-trail block — and assert a valid PDF is still produced without throwing.
test('generateEmploymentApplicationPdf renders header, previous-address street, long employer name, work-auth and audit trail', async () => {
  const buf = await generateEmploymentApplicationPdf(
    {
      id: 'app-123',
      signed_certification_at: '2026-06-13T12:00:00.000Z',
      applicant_snapshot: {
        firstName: 'John',
        lastName: 'Doe',
        applicantPrintedName: 'John Doe',
        workAuthorization: {
          legallyAuthorizedToWork: 'yes',   // adverse is NO → should NOT be red
          convictedOfFelony: 'no',          // adverse is YES → should NOT be red
          unableToPerformFunctions: 'no'
        },
        drugAlcohol: { violatedSubstanceProhibitions: 'no' }
      },
      residencies: [
        { residency_type: 'current', street: '1 Current St', city: 'Dallas', state: 'TX', zip_code: '75001', years_at_address: '2' },
        { residency_type: 'previous', street: '99 Previous Ave', city: 'Austin', state: 'TX', zip_code: '78701', years_at_address: '3' }
      ],
      licenses: [],
      accidents: [],
      convictions: [],
      employers: [
        { company_name: 'A Very Long Transportation And Logistics Company Name LLC International', phone: '555-111-2222', is_current: true }
      ]
    },
    {
      operatingEntity: { name: 'Acme Carriers Inc', address: '500 Fleet Rd, Dallas, TX 75001', phone: '555-000-1111', email: 'ops@acme.test' },
      auditTrail: { ipAddress: '203.0.113.7', userAgent: 'Mozilla/5.0 Test', submittedAt: '2026-06-13T12:00:00.000Z' }
    }
  );

  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 1000);
  assert.equal(String(buf.slice(0, 4)), '%PDF');
});
