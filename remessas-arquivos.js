/* Serra Azul BF • Arquivos da Remessa (pneus) | private Supabase Storage */
(function () {
  'use strict';
  var BUCKET = 'sa-tire-attachments';
  var MAX_BYTES = 15 * 1024 * 1024;
  var TYPES = {pdf:'application/pdf',xml:'application/xml',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp'};

  function canUseSupabase() { return typeof supabaseClient !== 'undefined' && !!supabaseClient; }
  function isAdmin() { return typeof currentUserRole !== 'undefined' && currentUserRole === 'admin'; }
  function bytes(n) { return Number(n||0) < 1024*1024 ? (Number(n||0)/1024).toFixed(0)+' KB' : (Number(n||0)/(1024*1024)).toFixed(1)+' MB'; }
  function datePt(x) { try { return new Date(x).toLocaleString('pt-BR', {dateStyle:'short',timeStyle:'short'}); } catch (_) { return '—'; } }
  function extension(filename) { var p = String(filename||'').lastIndexOf('.'); return p<0?'':filename.slice(p+1).toLowerCase(); }
  function validFile(file) {
    var ext = extension(file.name);
    if (!TYPES[ext]) return 'Formato não permitido: ' + file.name + '. Use PDF, XML, JPG, PNG ou WEBP.';
    if (!file.size || file.size > MAX_BYTES) return file.name + ': o limite é de 15 MB por arquivo.';
    if (file.name.length > 240) return 'Nome de arquivo muito longo: ' + file.name.slice(0,40);
    return '';
  }
  function iconFor(name) { var e=extension(name); return e==='pdf'?'📕':e==='xml'?'📑':'🖼️'; }
  function feedback(panel, message, type) {
    var el=panel.querySelector('.sa-tire-files-feedback');
    if (!el) return;
    el.textContent=message||'';
    el.className='sa-tire-files-feedback'+(type?' is-'+type:'');
  }
  function matching(panel,id) { return !!panel && panel.isConnected && panel.dataset.shipmentId===id; }

  async function userId() {
    if (!canUseSupabase()) throw new Error('Conexão com Supabase indisponível.');
    var resp=await supabaseClient.auth.getUser();
    if (resp.error) throw resp.error;
    if (!resp.data || !resp.data.user) throw new Error('Faça login para acessar os documentos.');
    return resp.data.user.id;
  }
  function control(text, click, cls) {
    var button=document.createElement('button');
    button.type='button';
    button.className='sa-tire-file-action'+(cls?' '+cls:'');
    button.textContent=text;
    button.addEventListener('click',click);
    return button;
  }
  function renderItem(panel, record, uid) {
    var row=document.createElement('div');
    row.className='sa-tire-file-row';
    var icon=document.createElement('div');
    icon.className='sa-tire-file-glyph';
    icon.setAttribute('aria-hidden','true');
    icon.textContent=iconFor(record.original_name);
    var meta=document.createElement('div');
    meta.className='sa-tire-file-meta';
    var title=document.createElement('span');
    title.className='sa-tire-file-name';
    title.textContent=record.original_name;
    title.title=record.original_name;
    var detail=document.createElement('span');
    detail.className='sa-tire-file-extra';
    detail.textContent=bytes(record.byte_size)+' · '+datePt(record.created_at);
    meta.append(title,detail);
    var actions=document.createElement('div');
    actions.className='sa-tire-file-actions';
    actions.append(control('Abrir arquivo', async function(){
      var tab=window.open('about:blank','_blank');
      try {
        feedback(panel,'Preparando visualização segura...');
        var out=await supabaseClient.storage.from(BUCKET).createSignedUrl(record.storage_path,120);
        if(out.error) throw out.error;
        if(!out.data || !out.data.signedUrl) throw new Error('Link indisponível.');
        if(tab) { tab.opener=null; tab.location.replace(out.data.signedUrl); }
        else window.location.assign(out.data.signedUrl);
        feedback(panel,'Link temporário válido por 2 minutos.','success');
      } catch(err) {
        if(tab)tab.close();
        feedback(panel,'Não foi possível abrir: '+(err.message||err),'error');
      }
    }));
    if(uid===record.created_by || isAdmin() || record.storage_only) {
      actions.append(control('Excluir',async function(){
        if (!window.confirm('Excluir definitivamente o arquivo "'+record.original_name+'"?')) return;
        try {
          feedback(panel,'Excluindo documento...');
          var storage=await supabaseClient.storage.from(BUCKET).remove([record.storage_path]);
          if(storage.error) throw storage.error;
          if(!storage.data || !storage.data.length) throw new Error('Exclusão não autorizada.');
          if(record.id) {
            var db=await supabaseClient.from('sa_tire_attachments').delete().eq('id',record.id);
            if(db.error) throw db.error;
          }
          feedback(panel,'Documento excluído.','success');
          await loadFiles(panel.dataset.shipmentId,panel);
        } catch(err) { feedback(panel,'Falha ao excluir: '+(err.message||err),'error'); }
      },'danger'));
    }
    row.append(icon,meta,actions);
    return row;
  }

  async function loadFiles(id,panel) {
    if (!matching(panel,id)) return;
    var list=panel.querySelector('.sa-tire-files-list');
    var count=panel.querySelector('.sa-tire-files-count');
    list.textContent='Carregando documentos...';
    count.textContent='...';
    try {
      var uid=await userId();
      var r=await supabaseClient.from('sa_tire_attachments')
        .select('id,shipment_id,original_name,storage_path,byte_size,mime_type,created_by,created_at')
        .eq('shipment_id',id).order('created_at',{ascending:false});
      if(r.error) throw r.error;
      if (!matching(panel,id)) return;
      // Mesma pasta para anexos antigos (Storage direto) e novos (Storage + cadastro).
      // A fonte de arquivos é o bucket privado; o cadastro mantém nomes e autoria.
      var registered=r.data||[];
      var byPath=new Map(registered.map(function(f){return [f.storage_path,f];}));
      var stored=await supabaseClient.storage.from(BUCKET).list(id,{limit:1000,sortBy:{column:'created_at',order:'desc'}});
      if(stored.error) throw stored.error;
      if(!matching(panel,id)) return;
      var files=(stored.data||[]).filter(function(o){return o.id && o.name;}).map(function(o){
        var path=id+'/'+o.name;
        var known=byPath.get(path);
        if(known){byPath.delete(path);return known;}
        // Arquivos enviados pela primeira versão não têm linha em sa_tire_attachments.
        var original=o.name.replace(/^[0-9a-f]{8}-[0-9a-f-]{27,}_/i,'');
        return {id:null,shipment_id:id,original_name:original,storage_path:path,
          byte_size:Number(o.metadata&&o.metadata.size||0),created_at:o.created_at||o.updated_at,
          created_by:o.owner_id||null,storage_only:true};
      });
      // Se o Storage tiver algum arquivo temporariamente não listado, preserve o registro.
      byPath.forEach(function(f){files.push(f);});
      files.sort(function(a,b){return String(b.created_at||'').localeCompare(String(a.created_at||''));});
      count.textContent=files.length+' '+(files.length===1?'arquivo':'arquivos');
      list.replaceChildren();
      if(!files.length) {
        var empty=document.createElement('div');
        empty.className='sa-tire-files-empty';
        empty.textContent='Nenhum documento nesta remessa. Adicione a nota fiscal ou imagens para manter o histórico organizado.';
        list.append(empty);
      } else {
        files.forEach(function(f){list.append(renderItem(panel,f,uid));});
      }
    } catch(err) {
      if (!matching(panel,id)) return;
      list.textContent='';
      count.textContent='Indisponível';
      feedback(panel,'Erro ao listar anexos: '+(err.message||err),'error');
    }
  }

  async function uploadFiles(id,panel,files) {
    if(!matching(panel,id) || !files.length) return;
    if(files.length>10) return feedback(panel,'Envie até 10 arquivos por vez.','error');
    for(var i=0;i<files.length;i++) {
      var invalid=validFile(files[i]);
      if(invalid) return feedback(panel,invalid,'error');
    }
    var button=panel.querySelector('[data-sa-files-pick]');
    button.disabled=true;
    var uploaded=0;
    try {
      var uid=await userId();
      for(var j=0;j<files.length;j++) {
        if(!matching(panel,id)) break;
        var f=files[j], ext=extension(f.name);
        feedback(panel,'Enviando '+(j+1)+' de '+files.length+': '+f.name);
        var path=id+'/'+crypto.randomUUID()+'.'+ext;
        var uploadedFile=await supabaseClient.storage.from(BUCKET).upload(path,f,{
          cacheControl:'3600',upsert:false,contentType:TYPES[ext]
        });
        if(uploadedFile.error) throw uploadedFile.error;
        var write=await supabaseClient.from('sa_tire_attachments').insert({
          shipment_id:id,storage_path:path,original_name:f.name,mime_type:TYPES[ext],
          byte_size:f.size,created_by:uid
        });
        if(write.error) {
          try { await supabaseClient.storage.from(BUCKET).remove([path]); } catch (_) {}
          throw write.error;
        }
        uploaded++;
      }
      if(matching(panel,id)) feedback(panel,uploaded+' '+(uploaded===1?'arquivo enviado':'arquivos enviados')+' com sucesso.','success');
    } catch(err) {
      if(matching(panel,id)) feedback(panel,'Falha no envio: '+(err.message||err)+(uploaded?' ('+uploaded+' enviado(s)).':''),'error');
    } finally {
      if(matching(panel,id)) {
        button.disabled=false;
        var fileInput=panel.querySelector('[data-sa-files-input]');
        if(fileInput)fileInput.value='';
        await loadFiles(id,panel);
      }
    }
  }

  function mount(id) {
    var host=document.getElementById('sa-tire-detail-content');
    if(!host || !id) return;
    var panel=document.createElement('section');
    panel.id='sa-tire-attachments';
    panel.className='sa-tire-files-panel';
    panel.dataset.shipmentId=id;
    panel.setAttribute('aria-label','Arquivos da remessa');
    panel.innerHTML=[
      '<div class="sa-tire-files-head">',
      ' <div class="sa-tire-files-title"><span class="sa-tire-files-icon" aria-hidden="true">📁</span>',
      ' <div><h3>Arquivos da Remessa</h3><p class="sa-tire-files-sub">Notas fiscais, XML e imagens vinculados a esta remessa</p></div></div>',
      ' <span class="sa-tire-files-count" aria-live="polite">Carregando...</span>',
      '</div>',
      '<div class="sa-tire-files-drop" data-sa-files-drop>',
      ' <strong>Arraste seus documentos para esta área</strong>',
      ' <small>PDF, XML, JPG, PNG ou WEBP · até 15 MB por arquivo</small>',
      ' <button class="sa-tire-files-button" data-sa-files-pick type="button">+ Adicionar arquivos</button>',
      ' <input data-sa-files-input type="file" multiple hidden accept=".pdf,.xml,.jpg,.jpeg,.png,.webp,application/pdf,application/xml,text/xml,image/jpeg,image/png,image/webp">',
      '</div>',
      '<div class="sa-tire-files-feedback" role="status" aria-live="polite"></div>',
      '<div class="sa-tire-files-list" aria-live="polite"></div>'
    ].join('');
    host.append(panel);
    var picker=panel.querySelector('[data-sa-files-input]');
    panel.querySelector('[data-sa-files-pick]').addEventListener('click',function(){picker.click();});
    picker.addEventListener('change',function(){uploadFiles(id,panel,Array.from(picker.files||[]));});
    var drop=panel.querySelector('[data-sa-files-drop]');
    ['dragenter','dragover'].forEach(function(name){
      drop.addEventListener(name,function(e){e.preventDefault();e.stopPropagation();drop.classList.add('is-over');});
    });
    ['dragleave','dragend'].forEach(function(name){
      drop.addEventListener(name,function(e){e.preventDefault();e.stopPropagation();drop.classList.remove('is-over');});
    });
    drop.addEventListener('drop',function(e){
      e.preventDefault();e.stopPropagation();drop.classList.remove('is-over');
      uploadFiles(id,panel,Array.from(e.dataTransfer?e.dataTransfer.files:[]));
    });
    loadFiles(id,panel);
  }

  function install(){
    var original=window.saTireDetail;
    if(typeof original!=='function' || original.__saAttachmentsInstalled) return;
    var wrapped=function(id){
      var result=original.apply(this,arguments);
      try { mount(String(id||'')); } catch(err){console.error('Arquivos da remessa',err);}
      return result;
    };
    wrapped.__saAttachmentsInstalled=true;
    window.saTireDetail=wrapped;
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',install);
  else install();
})();