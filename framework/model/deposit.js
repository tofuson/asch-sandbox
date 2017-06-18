module.exports = {
  table: 'deposits',
  tableFields: [
    {
      name: 'tid',
      type: 'String',
      length: 64,
      not_null: true,
      unique: true,
      primary_key: true
    },
    {
      name: 'srcId',
      type: 'String',
      length: 64,
      not_null: true,
      unique: true
    },
    {
      name: 'recipientId',
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
      name: 'amount',
      type: 'String',
      length: 50,
      not_null: true
    }
  ]
}