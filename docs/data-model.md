# Data Model

The platform metadata model is:

```text
dataStores[]
  name
  collection
  description
  fields[]
    name
    description
    type
    enumValues?
    referenceTo?
    role?
```

Supported field types:

- `string`
- `number`
- `integer`
- `boolean`
- `date`
- `datetime`
- `enum`
- `reference`
- `array`
- `object`
- `geo`

Supported field roles:

- `id`
- `dimension`
- `measure`
- `temporal`

The tenant guard is applied through `scope.tenantId` during MongoDB aggregation.
