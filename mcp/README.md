# triplan-mcp

A remote MCP server (claude.ai custom connector) for the triplan trip planner. It lets Claude read and change trips, days, activities, ideas, documents, packing lists, suggestions and sharing, and shows inline cards (MCP Apps) for the results. It signs in to Firebase as one dedicated user over REST, so `firestore.rules` stay the security boundary: the connector can only do what that user may do.

## Tools

| Area        | Tools                                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| Trips       | `list_trips`, `get_trip`, `create_trip`, `update_trip`, `delete_trip`, `join_trip`                             |
| Days        | `get_day`, `add_day`, `update_day`, `delete_day`, `save_day_group`, `delete_day_group`                         |
| Activities  | `add_activity`, `update_activity`, `delete_activity`, `move_activity`                                          |
| Ideas       | `list_ideas`, `add_idea`, `update_idea`, `delete_idea`, `schedule_idea`                                        |
| Documents   | `list_documents`, `add_document`, `update_document`, `delete_document`                                         |
| Budget      | `get_budget`                                                                                                   |
| Packing     | `get_packing_list`, `add_packing_item`, `update_packing_item`, `delete_packing_item`                           |
| Suggestions | `list_suggestions`, `send_suggestion`, `respond_suggestion`, `get_activity_feed`                               |
| Sharing     | `get_sharing`, `regenerate_invite_code`, `remove_member`                                                       |
| Profile     | `get_my_profile`, `set_display_name`                                                                           |

## Security

The connector acts as one Firebase user, so the endpoint is protected by `MCP_SECRET`, sent as `?key=...` in the URL (claude.ai custom connectors take a URL) or as `Authorization: Bearer ...`. Treat the full URL like a password. The connector signs in with your own triplan account (email and password), so it sees your trips and nothing else; no separate user is needed. Without `MCP_SECRET` the server refuses to run unless `TRIPLAN_MOCK=1`.

## Configuration

| Variable                                      | Purpose                                                  |
| --------------------------------------------- | -------------------------------------------------------- |
| `TRIPLAN_EMAIL`, `TRIPLAN_PASSWORD`           | Your own triplan account email and password             |
| `MCP_SECRET`                                  | Secret for the endpoint                                  |
| `FIREBASE_API_KEY`, `FIREBASE_PROJECT_ID`     | Public web config of the Firebase project                |
| `TRIPLAN_MOCK=1`                              | In-memory data, no Firebase (tests only)                 |
| `FIREBASE_EMULATOR=1`                         | Use the local Emulator Suite (auth 9099, firestore 8080) |

## Run and test

```
npm install
npm run typecheck
TRIPLAN_MOCK=1 PORT=3351 npm run dev
npm test -- http://localhost:3351/mcp
```

The rules test (`npm run test:rules`) runs the tools against the real `firestore.rules` of the triplan repo on the emulators. See `CONTRIBUTING.md`.

## Deploy (Vercel)

1. In Firebase Authentication enable the Email/Password provider. If you sign in to the app with Google only, set a password for the same email once (password reset), so the connector can use it.
2. Create a long random secret: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`.
3. Import this repository in Vercel and add the variables above.
4. Deploy, then in claude.ai go to Settings, Connectors, Add custom connector, and paste `https://<host>/mcp?key=<MCP_SECRET>`.
5. After adding tools, remove and re-add the connector, because claude.ai caches the tool list.
6. Nothing else to set up: your trips are already yours.

## License

MIT, GIAMAT13.
