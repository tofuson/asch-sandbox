module.exports = {
  table: 'round_fees',
  tableFields: [
    {
      name: 'round',
      type: 'Number',
      not_null: true,
      index: true,
    },
    {
      name: 'currency',
      type: 'String',
      length: 30,
      not_null: true
    },
    {
      name: 'amount',
      type: 'String',
      length: 50,
      not_null: true
    }
  ]
}