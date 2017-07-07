app.route.get('/contracts', async (req) => {
  let contracts = []
  for (let type in app.contractTypeMapping) {
    contracts.push({
      type: type,
      name: app.contractTypeMapping[type]
    })
  }
  return {contracts: contracts}
})