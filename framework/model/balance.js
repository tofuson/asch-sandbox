module.exports = {
  table: 'balances',
  tableFields: [
    {
      name: 'address',
      type: 'String',
      length: 50,
      not_null: true
    },
    {
      name: 'currency',
      type: 'String',
      length: 30,
      not_null: true
    },
    {
      name: 'balance',
      type: 'String',
      length: 50,
      not_null: true
    }
  ]
}