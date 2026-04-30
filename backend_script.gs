// ==========================================
// สเน่ห์POS - BACKEND SCRIPT (TABLE-BASED)
// ==========================================
// Instructions: 
// 1. Open your existing Google Apps Script editor.
// 2. Erase the old code and paste this entire file in.
// 3. Click "Deploy" -> "New Deployment" -> Execute as "Me", Access "Anyone".
// 4. Update the GAS_URL in App.jsx if the URL changes.
// ==========================================

var SHEET_ID = '1QSsVi6No7HJKqBcPiXcX_Xs1iMC9SRk6bydJ88dGNP4';

function getOrCreateSheet(ss, sheetName, headers) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if(headers) {
      sheet.appendRow(headers);
    }
  }
  return sheet;
}

function initializeSheets() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  getOrCreateSheet(ss, 'Orders', ['Timestamp', 'OrderNumber', 'CustomerName', 'Address', 'ItemDetail', 'DiningOption', 'Price', 'TotalAmount', 'Status', 'OrderStartTime', 'CompletionTime']);
  getOrCreateSheet(ss, 'Categories', ['slug', 'name', 'nameEn', 'icon', 'isActive', 'hasPopup1', 'popup1Category', 'popup1Items', 'popup1Min', 'popup1Max', 'popup1ItemsMax', 'popup1Free', 'hasPopup2', 'popup2Category', 'popup2Items', 'popup2Min', 'popup2Max', 'popup2ItemsMax', 'popup2Free', 'hasPopup3', 'popup3Category', 'popup3Items', 'popup3Min', 'popup3Max', 'popup3ItemsMax', 'popup3Free', 'hasPopup4', 'popup4Category', 'popup4Items', 'popup4Min', 'popup4Max', 'popup4ItemsMax', 'popup4Free', 'hasPopup5', 'popup5Category', 'popup5Items', 'popup5Min', 'popup5Max', 'popup5ItemsMax', 'popup5Free', 'hasPopup6', 'popup6Category', 'popup6Items', 'popup6Min', 'popup6Max', 'popup6ItemsMax', 'popup6Free', 'hasDining']);
  getOrCreateSheet(ss, 'Menu', ['id', 'category', 'name', 'nameEn', 'description', 'descriptionEn', 'price', 'image', 'isActive', 'bundledItems']);
  getOrCreateSheet(ss, 'Promotions', ['id', 'name', 'nameEn', 'price', 'origPrice']);
  getOrCreateSheet(ss, 'TableOrders', ['TableNumber', 'SessionId', 'ItemName', 'ItemNameEn', 'ItemPrice', 'Quantity', 'Options', 'Timestamp', 'Status']);
}

function doGet(e) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : 'getAllData';
  
  initializeSheets();
  
  if (action === 'getAllData') {
    var data = {
      orders: getSheetDataAsObjects(ss, 'Orders'),
      categories: getSheetDataAsObjects(ss, 'Categories'),
      menu: getSheetDataAsObjects(ss, 'Menu'),
      promotions: getSheetDataAsObjects(ss, 'Promotions'),
      tableOrders: getSheetDataAsObjects(ss, 'TableOrders')
    };
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'getTableOrders') {
    var tableNumber = e.parameter.tableNumber || '';
    var sheet = ss.getSheetByName('TableOrders');
    var allRows = getSheetDataAsObjects(ss, 'TableOrders');
    var filtered = allRows.filter(function(r) {
      return String(r.TableNumber) === String(tableNumber) && r.Status !== 'paid';
    });
    return ContentService.createTextOutput(JSON.stringify({ success: true, orders: filtered }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  if (action === 'resetAllSheetData') {
    var catSheet = ss.getSheetByName('Categories');
    if (catSheet && catSheet.getLastRow() > 1) {
      catSheet.deleteRows(2, catSheet.getLastRow() - 1);
    }
    var menuSheet = ss.getSheetByName('Menu');
    if (menuSheet && menuSheet.getLastRow() > 1) {
      menuSheet.deleteRows(2, menuSheet.getLastRow() - 1);
    }
    var promoSheet = ss.getSheetByName('Promotions');
    if (promoSheet && promoSheet.getLastRow() > 1) {
      promoSheet.deleteRows(2, promoSheet.getLastRow() - 1);
    }
    return ContentService.createTextOutput(JSON.stringify({ success: true, message: 'All data cleared' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({ error: 'Unknown GET action' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheetDataAsObjects(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  
  var headers = data[0];
  var result = [];
  for (var i = 1; i < data.length; i++) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      var headerName = headers[j];
      if (headerName) {
         var val = data[i][j];
         if (typeof val === 'string' && (val.trim().startsWith('[') || val.trim().startsWith('{'))) {
           try { val = JSON.parse(val.trim()); } catch(e) {}
         }
         obj[headerName] = val;
      }
    }
    result.push(obj);
  }
  return result;
}

function doPost(e) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  initializeSheets();
  
  var postData = {};
  try {
    if (e.postData.contents) {
      postData = JSON.parse(e.postData.contents);
    }
  } catch(err) {
    try {
      postData = JSON.parse(e.postData.getDataAsString());
    } catch(err2) {
      return ContentService.createTextOutput(JSON.stringify({"success": false, "error": "Invalid Content"})).setMimeType(ContentService.MimeType.JSON);
    }
  }
  
  var action = postData.action || 'insertOrder';

  // ==========================================
  // TABLE ORDER ACTIONS
  // ==========================================

  // Add items to a table session (called each time user sends order from cart)
  if (action === 'addTableOrder') {
    var sheet = ss.getSheetByName('TableOrders');
    var tableNumber = postData.tableNumber || '';
    var sessionId = postData.sessionId || String(Date.now());
    var items = postData.items || [];
    var timestamp = postData.timestamp || new Date().toISOString();

    items.forEach(function(item) {
      var options = '';
      var parts = [];
      if (item.spice && item.spice.name) parts.push('ความเผ็ด: ' + item.spice.name);
      if (item.allPopups && item.allPopups.length > 0) {
        item.allPopups.forEach(function(p) { parts.push(p.name); });
      }
      if (item.promo && item.promo.id !== 'none' && item.promo.name) parts.push(item.promo.name);
      options = parts.join(', ');

      sheet.appendRow([
        tableNumber,
        sessionId,
        item.food.name || '',
        item.food.nameEn || '',
        Number(item.food.price) || 0,
        Number(item.quantity) || 1,
        options,
        timestamp,
        'pending'
      ]);
    });

    return ContentService.createTextOutput(JSON.stringify({ success: true, sessionId: sessionId }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Clear all pending orders for a table (called after payment)
  if (action === 'clearTableOrders') {
    var sheet = ss.getSheetByName('TableOrders');
    var tableNumber = String(postData.tableNumber || '');
    var data = sheet.getDataRange().getValues();
    // Delete rows from bottom to top to avoid index shifting
    for (var i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0]) === tableNumber && data[i][8] !== 'paid') {
        sheet.deleteRow(i + 1);
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Delete a single table order item by row index
  if (action === 'deleteTableOrderItem') {
    var sheet = ss.getSheetByName('TableOrders');
    var tableNumber = String(postData.tableNumber || '');
    var sessionId = String(postData.sessionId || '');
    var itemName = String(postData.itemName || '');
    var data = sheet.getDataRange().getValues();
    var deleted = false;
    for (var i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0]) === tableNumber && 
          String(data[i][1]) === sessionId &&
          String(data[i][2]) === itemName &&
          !deleted) {
        sheet.deleteRow(i + 1);
        deleted = true;
        break;
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ success: deleted }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Move or Merge tables
  if (action === 'moveTable') {
    var sheet = ss.getSheetByName('TableOrders');
    var fromTable = String(postData.fromTable || '');
    var toTable = String(postData.toTable || '');
    var data = sheet.getDataRange().getValues();
    var updated = false;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === fromTable && data[i][8] !== 'paid') {
        sheet.getRange(i + 1, 1).setValue(toTable);
        updated = true;
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ success: updated }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ==========================================
  // ORDER ACTIONS
  // ==========================================

  if (action === 'insertOrder') {
    var sheet = ss.getSheetByName('Orders');
    if (postData.rows && Array.isArray(postData.rows)) {
      postData.rows.forEach(function(row) {
        sheet.appendRow(row);
      });
    }
    return ContentService.createTextOutput(JSON.stringify({"success": true}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  if (action === 'updateStatus') {
    var orderNumber = postData.orderNumber;
    var orderId = postData.orderId;
    var status = postData.status;
    var completionTime = postData.completionTime || '';
    var sheet = ss.getSheetByName('Orders');
    var data = sheet.getDataRange().getValues();
    
    var updated = false;
    for (var i = 1; i < data.length; i++) {
        if (data[i][1] === orderNumber || data[i][0] == orderId || data[i][1] == orderId) {
             sheet.getRange(i + 1, 9).setValue(status);
             if (status.toLowerCase() === 'completed' && completionTime) {
                 sheet.getRange(i + 1, 11).setValue(completionTime); 
             }
             updated = true;
        }
    }
    
    return ContentService.createTextOutput(JSON.stringify({"success": updated}))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ==========================================
  // ADMIN ACTIONS
  // ==========================================

  if (action === 'uploadImage') {
    try {
      var folderId = "11aWwDOmZO_mijABBSJjpm-0pHuhLvyYp";
      var folder = DriveApp.getFolderById(folderId);
      var data = Utilities.base64Decode(postData.base64);
      var blob = Utilities.newBlob(data, postData.mimeType, postData.filename);
      var file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      var publicUrl = 'https://drive.google.com/uc?export=view&id=' + file.getId();
      return ContentService.createTextOutput(JSON.stringify({"success": true, "url": publicUrl}))
        .setMimeType(ContentService.MimeType.JSON);
    } catch(e) {
      return ContentService.createTextOutput(JSON.stringify({"success": false, "error": e.toString()}))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  
  if (action === 'upsertMenu') {
    var sheet = ss.getSheetByName('Menu');
    var item = postData.item;
    if (!item || !item.id) return ContentService.createTextOutput(JSON.stringify({"success": false})).setMimeType(ContentService.MimeType.JSON);
    var data = sheet.getDataRange().getValues();
    var foundIndex = -1;
    for (var i = 1; i < data.length; i++) {
       if (data[i][0] == item.id) { foundIndex = i + 1; break; }
    }
    var rowData = [item.id, item.category || 'food', item.name || '', item.nameEn || '', item.description || '', item.descriptionEn || '', item.price || 0, item.image || '', item.isActive !== false ? true : false, item.bundledItems ? JSON.stringify(item.bundledItems) : '[]'];
    if (foundIndex !== -1) { sheet.getRange(foundIndex, 1, 1, rowData.length).setValues([rowData]); }
    else { sheet.appendRow(rowData); }
    return ContentService.createTextOutput(JSON.stringify({"success": true})).setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'deleteMenu') {
    var sheet = ss.getSheetByName('Menu');
    var id = postData.id;
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
       if (data[i][0] == id) { sheet.deleteRow(i + 1); return ContentService.createTextOutput(JSON.stringify({"success": true})).setMimeType(ContentService.MimeType.JSON); }
    }
    return ContentService.createTextOutput(JSON.stringify({"success": false, "error": "Not found"})).setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'saveMenu') {
    var sheet = ss.getSheetByName('Menu');
    sheet.clearContents();
    sheet.appendRow(['id', 'category', 'name', 'nameEn', 'description', 'descriptionEn', 'price', 'image', 'isActive', 'bundledItems']);
    var items = postData.items || [];
    items.forEach(function(item) {
      sheet.appendRow([item.id || Date.now(), item.category || 'food', item.name || '', item.nameEn || '', item.description || '', item.descriptionEn || '', item.price || 0, item.image || '', item.isActive !== false ? true : false, item.bundledItems ? JSON.stringify(item.bundledItems) : '[]']);
    });
    return ContentService.createTextOutput(JSON.stringify({"success": true})).setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'upsertPromotion') {
    var sheet = ss.getSheetByName('Promotions');
    var promo = postData.item;
    if (!promo || !promo.id) return ContentService.createTextOutput(JSON.stringify({"success": false})).setMimeType(ContentService.MimeType.JSON);
    var data = sheet.getDataRange().getValues();
    var foundIndex = -1;
    for (var i = 1; i < data.length; i++) {
       if (data[i][0] == promo.id) { foundIndex = i + 1; break; }
    }
    var rowData = [promo.id, promo.name || '', promo.nameEn || '', promo.price || 0, promo.origPrice || ''];
    if (foundIndex !== -1) { sheet.getRange(foundIndex, 1, 1, rowData.length).setValues([rowData]); }
    else { sheet.appendRow(rowData); }
    return ContentService.createTextOutput(JSON.stringify({"success": true})).setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'deletePromotion') {
    var sheet = ss.getSheetByName('Promotions');
    var id = postData.id;
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
       if (data[i][0] == id) { sheet.deleteRow(i + 1); return ContentService.createTextOutput(JSON.stringify({"success": true})).setMimeType(ContentService.MimeType.JSON); }
    }
    return ContentService.createTextOutput(JSON.stringify({"success": false})).setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'savePromotions') {
    var sheet = ss.getSheetByName('Promotions');
    sheet.clearContents();
    sheet.appendRow(['id', 'name', 'nameEn', 'price', 'origPrice']);
    var promos = postData.promotions || [];
    promos.forEach(function(promo) {
      sheet.appendRow([promo.id || Date.now(), promo.name || '', promo.nameEn || '', promo.price || 0, promo.origPrice || '']);
    });
    return ContentService.createTextOutput(JSON.stringify({"success": true})).setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'upsertCategory') {
    var sheet = ss.getSheetByName('Categories');
    var c = postData.item;
    if (!c || !c.slug) return ContentService.createTextOutput(JSON.stringify({"success": false})).setMimeType(ContentService.MimeType.JSON);
    var data = sheet.getDataRange().getValues();
    var foundIndex = -1;
    for (var i = 1; i < data.length; i++) {
       if (data[i][0] == c.slug) { foundIndex = i + 1; break; }
    }
    var rowData = [
        c.slug, c.name || '', c.nameEn || '', c.icon || '📌', c.isActive !== false ? true : false,
        c.hasPopup1 !== false ? true : false, c.popup1Category || '', c.popup1Items ? JSON.stringify(c.popup1Items) : '[]', c.popup1Min || 0, c.popup1Max || 0, c.popup1ItemsMax ? JSON.stringify(c.popup1ItemsMax) : '{}', c.popup1Free === true ? true : false,
        c.hasPopup2 === true ? true : false, c.popup2Category || '', c.popup2Items ? JSON.stringify(c.popup2Items) : '[]', c.popup2Min || 0, c.popup2Max || 0, c.popup2ItemsMax ? JSON.stringify(c.popup2ItemsMax) : '{}', c.popup2Free === true ? true : false,
        c.hasPopup3 === true ? true : false, c.popup3Category || '', c.popup3Items ? JSON.stringify(c.popup3Items) : '[]', c.popup3Min || 0, c.popup3Max || 0, c.popup3ItemsMax ? JSON.stringify(c.popup3ItemsMax) : '{}', c.popup3Free === true ? true : false,
        c.hasPopup4 === true ? true : false, c.popup4Category || '', c.popup4Items ? JSON.stringify(c.popup4Items) : '[]', c.popup4Min || 0, c.popup4Max || 0, c.popup4ItemsMax ? JSON.stringify(c.popup4ItemsMax) : '{}', c.popup4Free === true ? true : false,
        c.hasPopup5 === true ? true : false, c.popup5Category || '', c.popup5Items ? JSON.stringify(c.popup5Items) : '[]', c.popup5Min || 0, c.popup5Max || 0, c.popup5ItemsMax ? JSON.stringify(c.popup5ItemsMax) : '{}', c.popup5Free === true ? true : false,
        c.hasPopup6 === true ? true : false, c.popup6Category || '', c.popup6Items ? JSON.stringify(c.popup6Items) : '[]', c.popup6Min || 0, c.popup6Max || 0, c.popup6ItemsMax ? JSON.stringify(c.popup6ItemsMax) : '{}', c.popup6Free === true ? true : false,
        c.hasDining !== false ? true : false
    ];
    if (foundIndex !== -1) { sheet.getRange(foundIndex, 1, 1, rowData.length).setValues([rowData]); }
    else { sheet.appendRow(rowData); }
    return ContentService.createTextOutput(JSON.stringify({"success": true})).setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'deleteCategory') {
    var sheet = ss.getSheetByName('Categories');
    var slug = postData.slug;
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
       if (data[i][0] == slug) { sheet.deleteRow(i + 1); return ContentService.createTextOutput(JSON.stringify({"success": true})).setMimeType(ContentService.MimeType.JSON); }
    }
    return ContentService.createTextOutput(JSON.stringify({"success": false})).setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'saveCategories') {
    var sheet = ss.getSheetByName('Categories');
    sheet.clearContents();
    sheet.appendRow(['slug', 'name', 'nameEn', 'icon', 'isActive', 'hasPopup1', 'popup1Category', 'popup1Items', 'popup1Min', 'popup1Max', 'popup1ItemsMax', 'popup1Free', 'hasPopup2', 'popup2Category', 'popup2Items', 'popup2Min', 'popup2Max', 'popup2ItemsMax', 'popup2Free', 'hasPopup3', 'popup3Category', 'popup3Items', 'popup3Min', 'popup3Max', 'popup3ItemsMax', 'popup3Free', 'hasPopup4', 'popup4Category', 'popup4Items', 'popup4Min', 'popup4Max', 'popup4ItemsMax', 'popup4Free', 'hasPopup5', 'popup5Category', 'popup5Items', 'popup5Min', 'popup5Max', 'popup5ItemsMax', 'popup5Free', 'hasPopup6', 'popup6Category', 'popup6Items', 'popup6Min', 'popup6Max', 'popup6ItemsMax', 'popup6Free', 'hasDining']);
    var cats = postData.categories || [];
    cats.forEach(function(c) {
      sheet.appendRow([
        c.slug || Date.now().toString(), c.name || '', c.nameEn || '', c.icon || '📌', c.isActive !== false ? true : false,
        c.hasPopup1 !== false ? true : false, c.popup1Category || '', c.popup1Items ? JSON.stringify(c.popup1Items) : '[]', c.popup1Min || 0, c.popup1Max || 0, c.popup1ItemsMax ? JSON.stringify(c.popup1ItemsMax) : '{}', c.popup1Free === true ? true : false,
        c.hasPopup2 === true ? true : false, c.popup2Category || '', c.popup2Items ? JSON.stringify(c.popup2Items) : '[]', c.popup2Min || 0, c.popup2Max || 0, c.popup2ItemsMax ? JSON.stringify(c.popup2ItemsMax) : '{}', c.popup2Free === true ? true : false,
        c.hasPopup3 === true ? true : false, c.popup3Category || '', c.popup3Items ? JSON.stringify(c.popup3Items) : '[]', c.popup3Min || 0, c.popup3Max || 0, c.popup3ItemsMax ? JSON.stringify(c.popup3ItemsMax) : '{}', c.popup3Free === true ? true : false,
        c.hasPopup4 === true ? true : false, c.popup4Category || '', c.popup4Items ? JSON.stringify(c.popup4Items) : '[]', c.popup4Min || 0, c.popup4Max || 0, c.popup4ItemsMax ? JSON.stringify(c.popup4ItemsMax) : '{}', c.popup4Free === true ? true : false,
        c.hasPopup5 === true ? true : false, c.popup5Category || '', c.popup5Items ? JSON.stringify(c.popup5Items) : '[]', c.popup5Min || 0, c.popup5Max || 0, c.popup5ItemsMax ? JSON.stringify(c.popup5ItemsMax) : '{}', c.popup5Free === true ? true : false,
        c.hasPopup6 === true ? true : false, c.popup6Category || '', c.popup6Items ? JSON.stringify(c.popup6Items) : '[]', c.popup6Min || 0, c.popup6Max || 0, c.popup6ItemsMax ? JSON.stringify(c.popup6ItemsMax) : '{}', c.popup6Free === true ? true : false,
        c.hasDining !== false ? true : false
      ]);
    });
    return ContentService.createTextOutput(JSON.stringify({"success": true})).setMimeType(ContentService.MimeType.JSON);
  }
  
  // ==========================================
  // RESET / CLEAR ALL DATA (เคลียร์ข้อมูลเก่า)
  // ==========================================
  if (action === 'resetAllSheetData') {
    // Clear Categories (keep header only)
    var catSheet = ss.getSheetByName('Categories');
    if (catSheet && catSheet.getLastRow() > 1) {
      catSheet.deleteRows(2, catSheet.getLastRow() - 1);
    }

    // Clear Menu (keep header only)
    var menuSheet = ss.getSheetByName('Menu');
    if (menuSheet && menuSheet.getLastRow() > 1) {
      menuSheet.deleteRows(2, menuSheet.getLastRow() - 1);
    }

    // Clear Promotions (keep header only)
    var promoSheet = ss.getSheetByName('Promotions');
    if (promoSheet && promoSheet.getLastRow() > 1) {
      promoSheet.deleteRows(2, promoSheet.getLastRow() - 1);
    }

    return ContentService.createTextOutput(JSON.stringify({ success: true, message: 'All data cleared' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({"success": false, "error": "Unknown action"}))
      .setMimeType(ContentService.MimeType.JSON);
}
