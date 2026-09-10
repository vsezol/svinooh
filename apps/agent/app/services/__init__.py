"""What the service does, said in terms of ports rather than vendors.

The use cases: keeping a conversation, naming who is asking, deciding whether
they may ask again. They depend on app/domain and on the protocols in
app/ports, never on an adapter — which is what lets the storage underneath
change without a line moving here.
"""
