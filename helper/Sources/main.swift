import Foundation
import Cocoa
import SQLite3

// Default paths
let MESSAGES_DB = NSString(string: "~/Library/Messages/chat.db").expandingTildeInPath

// Output JSON result
func outputJSON(_ result: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]),
       let json = String(data: data, encoding: .utf8) {
        print(json)
    }
}

// Request Automation permission by using Messages.app
func requestAutomationAccess() -> [String: Any] {
    let script = """
    tell application "Messages"
        return version
    end tell
    """
    
    var errorInfo: NSDictionary?
    if let scriptObject = NSAppleScript(source: script) {
        let result = scriptObject.executeAndReturnError(&errorInfo)
        
        if let error = errorInfo {
            let errMsg = error[NSAppleScript.errorMessage] as? String ?? "Unknown error"
            return ["automation": false, "error": errMsg]
        }
        
        return ["automation": true, "version": result.stringValue ?? ""]
    }
    
    return ["automation": false, "error": "Cannot create AppleScript"]
}

// Check database access
func checkDatabaseAccess(dbPath: String) -> [String: Any] {
    var db: OpaquePointer?
    let result = sqlite3_open_v2(dbPath, &db, SQLITE_OPEN_READONLY, nil)
    
    if result == SQLITE_OK {
        defer { sqlite3_close(db) }
        
        var stmt: OpaquePointer?
        if sqlite3_prepare_v2(db, "SELECT COUNT(*) FROM message", -1, &stmt, nil) == SQLITE_OK {
            var count: Int64 = 0
            if sqlite3_step(stmt) == SQLITE_ROW {
                count = sqlite3_column_int64(stmt, 0)
            }
            sqlite3_finalize(stmt)
            return ["ok": true, "path": dbPath, "messageCount": count]
        }
    }
    
    let errorMsg = String(cString: sqlite3_errmsg(db))
    return ["ok": false, "error": errorMsg, "path": dbPath, "sqlite_result": result]
}

// Query messages
func queryRecentMessages(dbPath: String, lastRowid: Int64, limit: Int) -> [String: Any] {
    var db: OpaquePointer?
    
    let result = sqlite3_open_v2(dbPath, &db, SQLITE_OPEN_READONLY, nil)
    if result != SQLITE_OK {
        let errorMsg = String(cString: sqlite3_errmsg(db))
        return ["ok": false, "error": errorMsg, "messages": []]
    }
    
    defer { sqlite3_close(db) }
    
    let query = """
        SELECT 
            m.ROWID as rowid,
            m.text,
            m.handle_id,
            h.id as handle,
            m.service,
            m.date,
            m.is_from_me,
            c.ROWID as chat_id,
            c.guid as chat_guid
        FROM message m
        LEFT JOIN handle h ON m.handle_id = h.ROWID
        LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        LEFT JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE m.ROWID > ?
        AND m.text IS NOT NULL
        AND m.text != ''
        ORDER BY m.ROWID DESC
        LIMIT ?
    """
    
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, query, -1, &stmt, nil) == SQLITE_OK else {
        return ["ok": false, "error": "Cannot prepare query", "messages": []]
    }
    
    sqlite3_bind_int64(stmt, 1, lastRowid)
    sqlite3_bind_int(stmt, 2, Int32(limit))
    
    var messages: [[String: Any]] = []
    while sqlite3_step(stmt) == SQLITE_ROW {
        let rowid = sqlite3_column_int64(stmt, 0)
        let text = sqlite3_column_text(stmt, 1).map { String(cString: $0) } ?? ""
        let handleId = sqlite3_column_int64(stmt, 2)
        let handle = sqlite3_column_text(stmt, 3).map { String(cString: $0) } ?? ""
        let service = sqlite3_column_text(stmt, 4).map { String(cString: $0) } ?? ""
        let date = sqlite3_column_int64(stmt, 5)
        let isFromMe = sqlite3_column_int(stmt, 6)
        let chatId = sqlite3_column_int64(stmt, 7)
        let chatGuid = sqlite3_column_text(stmt, 8).map { String(cString: $0) } ?? ""
        
        let timestamp = (date / 1_000_000_000) + 978307200
        
        messages.append([
            "rowid": rowid,
            "text": text,
            "handle_id": handleId,
            "handle": handle,
            "service": service,
            "date": date,
            "timestamp": timestamp,
            "is_from_me": isFromMe,
            "chat_id": chatId,
            "chat_guid": chatGuid,
            "guid": "msg-\(rowid)"
        ])
    }
    
    sqlite3_finalize(stmt)
    return ["ok": true, "count": messages.count, "messages": messages]
}

// Get max ROWID
func getMaxRowid(dbPath: String) -> [String: Any] {
    var db: OpaquePointer?
    
    guard sqlite3_open_v2(dbPath, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
        return ["ok": false, "error": "Cannot open database"]
    }
    
    defer { sqlite3_close(db) }
    
    var maxRowid: Int64 = 0
    var stmt: OpaquePointer?
    
    if sqlite3_prepare_v2(db, "SELECT MAX(ROWID) FROM message", -1, &stmt, nil) == SQLITE_OK {
        if sqlite3_step(stmt) == SQLITE_ROW {
            maxRowid = sqlite3_column_int64(stmt, 0)
        }
        sqlite3_finalize(stmt)
    }
    
    return ["ok": true, "maxRowid": maxRowid]
}

// Main
func main() {
    let args = CommandLine.arguments
    let dbPath = ProcessInfo.processInfo.environment["IMESSAGE_DB_PATH"] ?? MESSAGES_DB
    
    guard args.count > 1 else {
        outputJSON(["error": "Usage: imessage-helper <command>", "commands": ["check", "query", "maxrowid", "auth"]])
        return
    }
    
    let command = args[1]
    
    switch command {
    case "auth":
        outputJSON(requestAutomationAccess())
        
    case "check":
        outputJSON(checkDatabaseAccess(dbPath: dbPath))
        
    case "maxrowid":
        outputJSON(getMaxRowid(dbPath: dbPath))
        
    case "query":
        var lastRowid: Int64 = 0
        var limit = 100
        var i = 2
        while i < args.count {
            if args[i] == "--since" && i + 1 < args.count {
                lastRowid = Int64(args[i + 1]) ?? 0
                i += 2
            } else if args[i] == "--limit" && i + 1 < args.count {
                limit = Int(args[i + 1]) ?? 100
                i += 2
            } else {
                i += 1
            }
        }
        outputJSON(queryRecentMessages(dbPath: dbPath, lastRowid: lastRowid, limit: limit))
        
    default:
        outputJSON(["error": "Unknown command: \(command)"])
    }
}

main()
