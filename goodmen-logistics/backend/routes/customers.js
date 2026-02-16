const express = require('express');
const router = express.Router();


const axios = require('axios');

module.exports = (knex) => {
    // FMCSA company info by DOT number (using JSON API)
    router.get('/fmcsainfo/:dot', async (req, res) => {
      try {
        const url = `https://mobile.fmcsa.dot.gov/qc/services/carriers/${req.params.dot}?webKey=94c7ff4bde4f4531bec510f7d3c4100d99f02350`;
        const response = await axios.get(url);
        const carrier = response.data && response.data.content && response.data.content.carrier;
        if (!carrier) return res.status(404).json({ error: 'Company not found' });
        res.json({
          name: carrier.legalName || carrier.dbaName || '',
          dot_number: carrier.dotNumber || '',
          address: carrier.phyStreet || '',
          city: carrier.phyCity || '',
          state: carrier.phyState || '',
          zip: carrier.phyZipcode || '',
          phone: '',
          email: ''
        });
      } catch (err) {
        res.status(500).json({ error: 'Failed to fetch FMCSA info' });
      }
    });
  // Search customers by name or DOT number
  router.get('/', async (req, res) => {
    const { q, dot } = req.query;
    try {
      let query = knex('customers');
      if (dot) {
        query = query.where('dot_number', dot);
      } else if (q) {
        query = query.where('name', 'ilike', `%${q}%`);
      }
      const customers = await query.select();
      res.json(customers);
    } catch (err) {
      res.status(500).json({ error: 'Failed to search customers' });
    }
  });

  // Create new customer
  router.post('/', async (req, res) => {
    const { name, dot_number, address, city, state, zip, phone, email } = req.body;
    try {
      const [customer] = await knex('customers')
        .insert({ name, dot_number, address, city, state, zip, phone, email })
        .returning('*');
      res.status(201).json(customer);
    } catch (err) {
      res.status(500).json({ error: 'Failed to create customer' });
    }
  });

  // Get customer by ID
  router.get('/:id', async (req, res) => {
    try {
      const customer = await knex('customers').where('id', req.params.id).first();
      if (!customer) return res.status(404).json({ error: 'Not found' });
      res.json(customer);
    } catch (err) {
      res.status(500).json({ error: 'Failed to get customer' });
    }
  });

  return router;
};
