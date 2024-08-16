This repo worked on node version 14.16.0
Run

```bash
nvm install
nvm use 14.16.0
yarn
yarn start
```

## Bug occured:

ERROR #85923 GRAPHQL

There was an error in your GraphQL query:

Cannot query field "cover" on type "MarkdownRemarkFrontmatter".

If you don't expect "cover" to exist on the type "MarkdownRemarkFrontmatter" it
is most likely a typo.
However, if you expect "cover" to exist there are a couple of solutions to
common problems:

- If you added a new data source and/or changed something inside
  gatsby-node.js/gatsby-config.js, please try a restart of your development server
- The field might be accessible in another subfield, please try your query in
  GraphiQL and use the GraphiQL explorer to see which fields you can query and
  what shape they have
- You want to optionally use your field "cover" and right now it is not used
  anywhere. Therefore Gatsby can't infer the type and add it to the GraphQL
  schema. A quick fix is to add at least one entry with that field ("dummy
  content")

It is recommended to explicitly type your GraphQL schema if you want to use
optional fields. This way you don't have to add the mentioned "dummy content".
Visit our docs to learn how you can define the schema for
"MarkdownRemarkFrontmatter":
https://www.gatsbyjs.com/docs/reference/graphql-data-layer/schema-customization#
creating-type-definitions

File: src/components/sections/featured.js:317:15

## Resolved:

Remove `cover` part on markdown file and add it again

```
info changed file at
/Users/nguyen/Anh/dev/v4/content/projects/StarburstDataProduct.md
info changed file at
/Users/nguyen/Anh/dev/v4/content/projects/StarburstDataProduct.md
success building schema - 0.587s
```

Explication: Schema missed matched => Schema will rebuild when re-adding `cover` part
