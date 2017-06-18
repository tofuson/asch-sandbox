module.exports = {
	table: 'blocks',
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
      name: 'height',
      type: 'BigInt',
      not_null: true
    },
    {
      name: 'payloadLength',
      type: 'BigInt',
      not_null: true
    },
    {
      name: 'payloadHash',
      type: 'String',
      length: 64,
      not_null: true
    },
    {
      name: 'prevBlockId',
      type: 'String',
      length: 64
    },
    {
      name: 'pointId',
      type: 'String',
      length: 64
    },
    {
      name: 'pointHeight',
      type: 'BigInt'
    },
    {
      name: 'delegate',
      type: 'String',
      length: 64,
      not_null: true
    },
    {
      name: 'signature',
      type: 'String',
      length: 128,
      not_null: true
    },
    {
      name: 'count',
      type: 'BigInt',
      not_null: true
    }
  ]
}