'use strict';

// Minimal knex stand-in for unit tests that import modules which `require`
// `@goodmen/shared/config/knex`. All DB-touching methods resolve to empty
// results so the unit tests can focus on pure logic.

function chain() {
  const self = {};
  const terminal = Promise.resolve([]);
  const passthrough = [
    'where',
    'whereRaw',
    'whereIn',
    'whereNot',
    'modify',
    'orderBy',
    'select',
    'first',
    'count',
    'insert',
    'update',
    'returning',
    'delete',
    'del',
    'clone',
    'limit',
    'offset',
    'max'
  ];
  passthrough.forEach((method) => {
    self[method] = () => self;
  });
  self.then = terminal.then.bind(terminal);
  self.catch = terminal.catch.bind(terminal);
  self.finally = terminal.finally.bind(terminal);
  return self;
}

const fakeKnex = (table) => chain();

fakeKnex.schema = {
  hasTable: async () => false,
  hasColumn: async () => false
};
fakeKnex.raw = () => Promise.resolve();
fakeKnex.transaction = async (cb) => cb(fakeKnex);
fakeKnex.fn = { now: () => new Date() };

module.exports = fakeKnex;
