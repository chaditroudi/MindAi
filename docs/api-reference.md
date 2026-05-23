# API Reference

Base URL: `http://localhost:3000`

## GET /health

Returns:

```json
{ "ok": true }
```

## GET /api/meta

Returns UI metadata and generated prompt suggestions based on available data stores and fields.

## POST /api/inquiry

Home/search style question. Returns a summary and record links.

```json
{
  "prompt": "find recent service requests where status is new",
  "dataStoreName": "ServiceRequests",
  "scope": {
    "userId": "u_demo",
    "tenantId": "t_mind_qatar",
    "allowedDataStores": ["ServiceRequests", "Inspections", "Permits", "Projects"]
  }
}
```

## POST /api/report

Report request. Returns report sections and optional charts.

## POST /api/dashboard

Dashboard request. Returns one chart.

Request fields:

- `prompt`: required natural-language request
- `scope.userId`: required
- `scope.tenantId`: required
- `scope.allowedDataStores`: optional allow-list
- `dataStoreName`: optional hint when the UI already knows the selected data store
- `theme`: optional chart theme: `light`, `dark`, or `brand`
