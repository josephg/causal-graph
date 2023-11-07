# Causal Graph

This is a helper library for operation based CRDTs and similar projects which need to track a causal graph (a graph of changes over time) in a compact and simple way.

This project exposes a type (CausalGraph) which stores a run-length encoded DAG (join semi-lattice) of entries. Each entry has the following fields:

- ID: This is an `(agent, seq)` tuple pair
- Parents: A list of other entries earlier in the graph which causally precede this entry

The causal graph associates each ID with a local version number (autoincrementing integer) to make a lot of operations faster & easier.

And the graph can be queried through a variety of tools:

- `versionContainsLV`: Figure out if a transitive subgraph contains a given version
- `diff`: Find the difference in two subgraphs
- `compareVersions`: Figure out if two versions are equal, concurrent, or one dominates the other
- `findDominators`: Find the dominator set of a set of versions. Ie, whats the minimal set of versions you can name which will transitively include all other versions?

Graphs can also be compared remotely via their vector clocks, and the differences serialized, sent and integrated.

For the full API, see the typescript type definitions.

This library is pre-1.0. The exposed API, and the serialization format may change without notice in subsequent versions.
