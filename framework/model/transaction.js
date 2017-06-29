module.exports = {
	table: 'transactions',
	tableFields: [
    {
      name: 'id',
      type: 'String',
      length: 64,
      not_null: true,
      unique: true,
      primary_key: true
    },
    {
      name: 'timestamp',
      type: 'BigInt',
      not_null: true
    },
    {
      name: 'senderId',
      type: 'String',
      length: 50,
      not_null: true
    },
    {
      name: 'senderPublicKey',
      type: 'String',
      length: 64,
      not_null: true
    },
    {
      name: 'fee',
      type: 'String',
      length: 50,
      not_null: true
    },
    {
      name: 'signature',
      type: 'String',
      length: 128,
      not_null: true
    },
    {
      name: 'type',
      type: 'Number',
      not_null: true
    },
    {
      name: 'args',
      type: 'Text'
    },
    {
      name: 'height',
      type: 'BigInt',
      not_null: true
    }
  ]
}