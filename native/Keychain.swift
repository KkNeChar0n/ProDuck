import Foundation
import Security

func respond(_ value: [String: Any], _ code: Int32 = 0) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: value)
    FileHandle.standardOutput.write(data)
    exit(code)
}
let input = FileHandle.standardInput.readDataToEndOfFile()
guard input.count <= 65536,
      let object = try? JSONSerialization.jsonObject(with: input) as? [String: String],
      let operation = object["operation"], let reference = object["reference"],
      UUID(uuidString: reference) != nil else { respond(["error": "invalid_request"], 1) }
let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "com.produck.credentials",
    kSecAttrAccount as String: reference
]
switch operation {
case "set":
    guard let value = object["value"], !value.isEmpty, value.utf8.count <= 16384 else { respond(["error":"invalid_value"],1) }
    let attributes: [String: Any] = [kSecValueData as String: Data(value.utf8)]
    let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
        var item = query
        item[kSecValueData as String] = Data(value.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let addStatus = SecItemAdd(item as CFDictionary,nil)
        guard addStatus == errSecSuccess else { respond(["error":"keychain_error","status":addStatus],1) }
    } else if status != errSecSuccess { respond(["error":"keychain_error","status":status],1) }
    respond(["ok":true])
case "get":
    var lookup=query
    lookup[kSecReturnData as String]=true
    lookup[kSecMatchLimit as String]=kSecMatchLimitOne
    var item:CFTypeRef?
    let status=SecItemCopyMatching(lookup as CFDictionary,&item)
    if status == errSecItemNotFound { respond(["value":NSNull()]) }
    guard status == errSecSuccess, let data=item as? Data, let value=String(data:data,encoding:.utf8) else { respond(["error":"keychain_error","status":status],1) }
    respond(["value":value])
case "delete":
    let status=SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { respond(["error":"keychain_error","status":status],1) }
    respond(["ok":true])
default: respond(["error":"invalid_operation"],1)
}
